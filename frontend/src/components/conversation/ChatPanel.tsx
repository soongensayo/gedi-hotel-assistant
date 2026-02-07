import { useState, useCallback } from 'react';
import { TranscriptDisplay } from './TranscriptDisplay';
import { VoiceButton } from './VoiceButton';
import { useConversationStore } from '../../stores/conversationStore';
import { useCheckinStore } from '../../stores/checkinStore';
import { sendChatMessage } from '../../services/api';
import { useVoiceOutput } from '../../hooks/useVoiceOutput';

/**
 * Chat panel that sits at the bottom of the kiosk screen.
 * Combines voice input, text input, and conversation transcript.
 */
export function ChatPanel() {
  const [textInput, setTextInput] = useState('');
  const { isLoading, addMessage, setLoading, setError } = useConversationStore();
  const { speak } = useVoiceOutput();
  const sessionId = useCheckinStore((s) => s.sessionId);

  const handleTextSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || isLoading) return;

    const message = textInput.trim();
    setTextInput('');
    addMessage({ role: 'user', content: message });
    setLoading(true);

    try {
      const { reply } = await sendChatMessage(message, sessionId);
      addMessage({ role: 'assistant', content: reply });
      speak(reply);
    } catch (err) {
      console.error('Chat failed:', err);
      setError('Failed to get response. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [textInput, isLoading, addMessage, setLoading, setError, speak, sessionId]);

  return (
    <div className="glass-panel p-4 flex flex-col gap-3">
      {/* Transcript */}
      <TranscriptDisplay />

      {/* Input area */}
      <div className="flex items-center gap-4">
        {/* Text input */}
        <form onSubmit={handleTextSubmit} className="flex-1">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type a message or tap the mic to speak..."
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-hotel-text placeholder-hotel-text-dim/50 focus:outline-none focus:border-hotel-accent/40 transition-colors"
            disabled={isLoading}
          />
        </form>

        {/* Voice button */}
        <div className="pb-6">
          <VoiceButton />
        </div>
      </div>
    </div>
  );
}
