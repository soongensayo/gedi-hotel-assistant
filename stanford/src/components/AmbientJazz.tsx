import { useEffect, useRef, useState } from 'react';

type Props = {
  enabled: boolean;
};

const chordProgression = [
  [261.63, 329.63, 392.0, 493.88],
  [293.66, 349.23, 440.0, 523.25],
  [246.94, 329.63, 392.0, 466.16],
  [220.0, 277.18, 349.23, 440.0],
];

const configuredJazzUrl = (
  import.meta.env.VITE_STANFORD_JAZZ_AUDIO_URL as string | undefined
)?.trim();

export function AmbientJazz({ enabled }: Props) {
  const engineRef = useRef<AmbientJazzEngine | null>(null);
  const [userStarted, setUserStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    if (!enabled) {
      engineRef.current?.stop();
      setPlaying(false);
      return;
    }

    if (!userStarted) return;

    engineRef.current ??= new AmbientJazzEngine(configuredJazzUrl);
    void engineRef.current.start().then((mode) => {
      setPlaying(mode !== 'blocked');
      setUsingFallback(mode === 'synth');
    });
  }, [enabled, userStarted]);

  useEffect(() => {
    return () => engineRef.current?.dispose();
  }, []);

  if (!enabled) return null;

  return (
    <button
      type="button"
      className="fixed right-4 top-4 z-50 rounded-full border border-[var(--color-hotel-border)] bg-[var(--guest-card-strong)] px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-hotel-accent)] shadow-[0_14px_36px_rgba(31,106,88,0.14)] backdrop-blur"
      onClick={() => {
        if (playing) {
          engineRef.current?.stop();
          setPlaying(false);
          return;
        }
        setUserStarted(true);
      }}
    >
      {playing ? (usingFallback ? 'Jazz ambience on' : 'Jazz on') : 'Tap for jazz'}
    </button>
  );
}

type JazzMode = 'track' | 'synth' | 'blocked';

class AmbientJazzEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private audio: HTMLAudioElement | null = null;
  private readonly trackUrl?: string;
  private step = 0;

  constructor(trackUrl?: string) {
    this.trackUrl = trackUrl;
  }

  async start(): Promise<JazzMode> {
    if (this.trackUrl) {
      const trackStarted = await this.startTrack();
      if (trackStarted) return 'track';
    }

    if (!this.context) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return 'blocked';

      this.context = new AudioContextCtor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.14;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        return 'blocked';
      }
    }

    if (this.master) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0.14, now, 0.35);
    }

    if (this.timer !== null) return 'synth';

    this.playStep();
    this.timer = window.setInterval(() => this.playStep(), 1700);
    return 'synth';
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
    }

    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }

    if (this.master && this.context) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0.0001, now, 0.4);
    }
  }

  dispose() {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.audio = null;
  }

  private async startTrack() {
    if (!this.trackUrl) return false;
    this.audio ??= new Audio(this.trackUrl);
    this.audio.loop = true;
    this.audio.volume = 0.32;

    try {
      await this.audio.play();
      return true;
    } catch {
      return false;
    }
  }

  private playStep() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const chord = chordProgression[this.step % chordProgression.length];
    const root = chord[0] / 2;

    chord.forEach((frequency, index) => {
      this.playTone(frequency, now + index * 0.018, 1.45, 0.08);
    });

    this.playTone(root, now + 0.02, 0.72, 0.16, 'sine');
    this.playTone(root * 1.5, now + 0.86, 0.52, 0.09, 'sine');
    this.playBrush(now + 0.02);
    this.playBrush(now + 0.86);
    this.step += 1;
  }

  private playTone(
    frequency: number,
    start: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'triangle'
  ) {
    if (!this.context || !this.master) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();

    osc.type = type;
    osc.frequency.value = frequency;
    filter.type = 'lowpass';
    filter.frequency.value = 1900;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.14);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private playBrush(start: number) {
    if (!this.context || !this.master) return;
    const length = Math.floor(this.context.sampleRate * 0.18);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();

    filter.type = 'highpass';
    filter.frequency.value = 2400;
    gain.gain.value = 0.035;
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
