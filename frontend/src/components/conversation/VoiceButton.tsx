import { useCallback } from 'react';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useConversationStore } from '../../stores/conversationStore';
import { sendChatMessage } from '../../services/api';
import { useVoiceOutput } from '../../hooks/useVoiceOutput';
import { useCheckinStore } from '../../stores/checkinStore';

export function VoiceButton() {
  const { isRecording, isProcessing, audioLevel, startRecording, stopRecording } = useVoiceInput();
  const { isLoading, isSpeaking, addMessage, setLoading, setError } = useConversationStore();
  const { speak } = useVoiceOutput();
  const sessionId = useCheckinStore((s) => s.sessionId);

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      const transcript = await stopRecording();
      if (transcript) {
        addMessage({ role: 'user', content: transcript });
        setLoading(true);

        try {
          const { reply } = await sendChatMessage(transcript, sessionId);
          addMessage({ role: 'assistant', content: reply });
          // Speak the reply
          speak(reply);
        } catch (err) {
          console.error('Chat failed:', err);
          setError('Failed to get response. Please try again.');
        } finally {
          setLoading(false);
        }
      }
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, stopRecording, addMessage, setLoading, setError, speak, sessionId]);

  const isDisabled = isLoading || isSpeaking || isProcessing;

  return (
    <button
      onClick={handleToggleRecording}
      disabled={isDisabled}
      className={`
        relative w-20 h-20 rounded-full transition-all duration-300 
        flex items-center justify-center
        ${isRecording
          ? 'bg-hotel-error/20 border-2 border-hotel-error/60 shadow-[0_0_30px_rgba(255,82,82,0.3)]'
          : 'bg-hotel-accent/15 border-2 border-hotel-accent/40 hover:bg-hotel-accent/25 hover:border-hotel-accent/60 shadow-[0_0_20px_rgba(0,212,255,0.15)]'
        }
        ${isDisabled && !isRecording ? 'opacity-40 cursor-not-allowed' : ''}
      `}
    >
      {/* Pulsing ring while recording */}
      {isRecording && (
        <div
          className="absolute inset-0 rounded-full border-2 border-hotel-error/40 animate-ping"
        />
      )}

      {/* Audio level ring */}
      {isRecording && (
        <div
          className="absolute inset-[-4px] rounded-full border border-hotel-error/30 transition-transform duration-100"
          style={{ transform: `scale(${1 + audioLevel * 0.3})` }}
        />
      )}

      {/* Microphone icon */}
      {isRecording ? (
        <svg className="w-8 h-8 text-hotel-error" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : isProcessing ? (
        <svg className="w-8 h-8 text-hotel-accent animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-8 h-8 text-hotel-accent" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      )}

      {/* Label */}
      <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-xs text-hotel-text-dim whitespace-nowrap">
        {isRecording ? 'Tap to stop' : isProcessing ? 'Processing...' : 'Tap to speak'}
      </span>
    </button>
  );
}
