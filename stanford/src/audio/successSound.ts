let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let removeUnlockListeners: (() => void) | null = null;

const SUCCESS_VOLUME = 0.16;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioContext && audioContext.state !== 'closed') return audioContext;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;

  audioContext = new AudioContextCtor();
  masterGain = audioContext.createGain();
  masterGain.gain.value = SUCCESS_VOLUME;
  masterGain.connect(audioContext.destination);
  return audioContext;
}

async function resumeSuccessSound() {
  const context = getAudioContext();
  if (!context || context.state !== 'suspended') return;

  try {
    await context.resume();
  } catch {
    // Browsers can reject audio startup without a user gesture; the next gesture will retry.
  }
}

export function enableSuccessSoundOnNextGesture() {
  if (audioContext?.state === 'running') return;
  if (removeUnlockListeners || typeof window === 'undefined') return;

  const unlock = () => {
    void resumeSuccessSound();
    removeUnlockListeners?.();
    removeUnlockListeners = null;
  };

  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true, passive: true });

  removeUnlockListeners = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
}

export function playSuccessSound() {
  const context = getAudioContext();
  if (!context || !masterGain) return;

  if (context.state === 'suspended') {
    void context.resume().then(() => playSuccessChime(context)).catch(() => undefined);
    return;
  }

  playSuccessChime(context);
}

function playSuccessChime(context: AudioContext) {
  if (!masterGain) return;

  const now = context.currentTime;
  playTone(context, 659.25, now, 0.18, 0.92);
  playTone(context, 987.77, now + 0.09, 0.2, 0.72);
  playTone(context, 1318.51, now + 0.18, 0.26, 0.48);
}

function playTone(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number
) {
  if (!masterGain) return;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3200, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.04);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
