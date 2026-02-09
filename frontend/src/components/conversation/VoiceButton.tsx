import { useCallback } from 'react';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useConversationStore } from '../../stores/conversationStore';

interface VoiceButtonProps {
  /** Called with transcribed text when the user finishes speaking. */
  onTranscript: (text: string) => void;
}

/**
 * Compact voice-mode toggle button.
 *
 * Tap once to enter hands-free listening mode (mic stays open, VAD auto-detects speech).
 * Tap again to turn it off. Visual states:
 *   - Idle:       Cyan mic icon, subtle border
 *   - Listening:  Cyan glow + gentle pulse (mic open, waiting for speech)
 *   - Recording:  Red glow + active ping (speech detected, capturing audio)
 *   - Processing: Spinner (transcribing with Whisper)
 */
export function VoiceButton({ onTranscript }: VoiceButtonProps) {
  const { isListening, isRecording, isProcessing, audioLevel, startListening, stopListening } =
    useVoiceInput(onTranscript);
  const { isLoading, isSpeaking } = useConversationStore();

  const handleToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Only fully disable when processing and NOT in listening mode
  const isDisabled = (isLoading || isProcessing) && !isListening;

  // Visual state
  const isIdle = !isListening;
  const isWaiting = isListening && !isRecording && !isProcessing;
  const isPaused = isListening && (isSpeaking || isLoading);

  return (
    <button
      onClick={handleToggle}
      disabled={isDisabled}
      className={`
        relative w-10 h-10 rounded-full transition-all duration-300
        flex items-center justify-center flex-shrink-0
        ${isRecording
          ? 'bg-hotel-error/20 border-2 border-hotel-error/60 shadow-[0_0_20px_rgba(255,82,82,0.3)]'
          : isListening
            ? 'bg-hotel-accent/20 border-2 border-hotel-accent/50 shadow-[0_0_15px_rgba(0,212,255,0.2)]'
            : 'bg-hotel-accent/15 border border-hotel-accent/40 hover:bg-hotel-accent/25 hover:border-hotel-accent/60 shadow-[0_0_10px_rgba(0,212,255,0.1)]'
        }
        ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}
        ${isPaused ? 'opacity-60' : ''}
      `}
      title={
        isRecording
          ? 'Listening...'
          : isProcessing
            ? 'Processing your speech...'
            : isListening
              ? isPaused
                ? 'Waiting for AI... (tap to stop)'
                : 'Voice mode on — just speak (tap to stop)'
              : 'Tap to start voice mode'
      }
    >
      {/* Active recording ping */}
      {isRecording && (
        <div className="absolute inset-0 rounded-full border-2 border-hotel-error/40 animate-ping" />
      )}

      {/* Gentle pulse while listening idle */}
      {isWaiting && !isPaused && (
        <div className="absolute inset-0 rounded-full border border-hotel-accent/30 animate-pulse" />
      )}

      {/* Audio level ring */}
      {isListening && (
        <div
          className={`absolute inset-[-3px] rounded-full border transition-transform duration-100 ${
            isRecording ? 'border-hotel-error/30' : 'border-hotel-accent/20'
          }`}
          style={{ transform: `scale(${1 + audioLevel * 0.3})` }}
        />
      )}

      {/* Icon */}
      {isProcessing ? (
        /* Spinner */
        <svg className="w-4 h-4 text-hotel-accent animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : isRecording ? (
        /* Mic icon — red (actively recording speech) */
        <svg className="w-4 h-4 text-hotel-error" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      ) : isListening ? (
        /* Mic icon — cyan (listening, waiting for speech) */
        <svg className="w-4 h-4 text-hotel-accent" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      ) : (
        /* Mic icon — default (not listening) */
        <svg className="w-4 h-4 text-hotel-accent/70" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      )}
    </button>
  );
}
