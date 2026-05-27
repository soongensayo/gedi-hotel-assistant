import { useEffect, useRef } from 'react';

type Props = {
  enabled: boolean;
};

const chordProgression = [
  [261.63, 329.63, 392.0, 493.88],
  [293.66, 349.23, 440.0, 523.25],
  [246.94, 329.63, 392.0, 466.16],
  [220.0, 277.18, 349.23, 440.0],
];

export function AmbientJazz({ enabled }: Props) {
  const engineRef = useRef<AmbientJazzEngine | null>(null);

  useEffect(() => {
    if (!enabled) {
      engineRef.current?.stop();
      return;
    }

    const start = () => {
      engineRef.current ??= new AmbientJazzEngine();
      void engineRef.current.start();
    };

    void start();

    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });

    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
  }, [enabled]);

  useEffect(() => {
    return () => engineRef.current?.dispose();
  }, []);

  return null;
}

class AmbientJazzEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private step = 0;

  async start() {
    if (!this.context) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;

      this.context = new AudioContextCtor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.045;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        return;
      }
    }

    if (this.timer !== null) return;

    this.playStep();
    this.timer = window.setInterval(() => this.playStep(), 2200);
  }

  stop() {
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
  }

  private playStep() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const chord = chordProgression[this.step % chordProgression.length];
    const root = chord[0] / 2;

    chord.forEach((frequency, index) => {
      this.playTone(frequency, now + index * 0.025, 1.9, 0.045);
    });

    this.playTone(root, now + 0.08, 1.35, 0.075, 'sine');
    this.playBrush(now + 0.02);
    this.playBrush(now + 1.1);
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
    filter.frequency.value = 1600;
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
    gain.gain.value = 0.012;
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
