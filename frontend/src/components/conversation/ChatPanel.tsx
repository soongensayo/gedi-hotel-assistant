import { useState, useCallback, useEffect, useRef } from 'react';
import { TranscriptDisplay } from './TranscriptDisplay';
import { VoiceButton } from './VoiceButton';
import { useConversationStore } from '../../stores/conversationStore';
import { useCheckinStore } from '../../stores/checkinStore';
import { sendChatMessage } from '../../services/api';
import type { AIAction } from '../../services/api';
import { useVoiceOutput } from '../../hooks/useVoiceOutput';
import { useCheckin } from '../../hooks/useCheckin';
import type { CheckinStep } from '../../types';

/**
 * Process AI actions returned from the backend and dispatch them
 * to the checkin store and trigger any necessary side-effects.
 */
function useActionProcessor() {
  const setStep = useCheckinStore((s) => s.setStep);
  const setReservation = useCheckinStore((s) => s.setReservation);
  const setGuest = useCheckinStore((s) => s.setGuest);
  const { handlePassportScan, handlePayment, handleCompleteCheckin } = useCheckin();

  const processActions = useCallback(
    (actions: AIAction[]) => {
      if (!actions || actions.length === 0) return;

      for (const action of actions) {
        switch (action.type) {
          case 'set_step': {
            const step = action.payload?.step as CheckinStep | undefined;
            if (step) {
              setStep(step);
            }
            break;
          }
          case 'store_reservation': {
            // Store reservation + guest data from AI lookup into the checkin store
            // so it's available as context for future messages
            if (action.payload) {
              setReservation(action.payload as unknown as import('../../types').Reservation);
              const guest = action.payload.guest as import('../../types').Guest | undefined;
              if (guest) {
                setGuest(guest);
              }
            }
            break;
          }
          case 'show_passport_scanner':
            setStep('passport-scan');
            // Auto-trigger the passport scan (mock auto-approves after ~10s)
            setTimeout(() => {
              handlePassportScan();
            }, 500);
            break;
          case 'show_payment':
            setStep('payment');
            // Auto-trigger payment processing (mock auto-approves)
            setTimeout(() => {
              handlePayment();
            }, 500);
            break;
          case 'show_key_card':
            setStep('key-card');
            // Auto-trigger key card dispensing
            setTimeout(() => {
              handleCompleteCheckin();
            }, 500);
            break;
        }
      }
    },
    [setStep, setReservation, setGuest, handlePassportScan, handlePayment, handleCompleteCheckin]
  );

  return processActions;
}

/**
 * Compact chat panel at the bottom of the kiosk screen.
 * Combines a small transcript, text input, and voice button in a tight strip.
 */
export function ChatPanel() {
  const [textInput, setTextInput] = useState('');
  const { isLoading, addMessage, setLoading, setError } = useConversationStore();
  const { speak } = useVoiceOutput();
  const sessionId = useCheckinStore((s) => s.sessionId);
  const currentStep = useCheckinStore((s) => s.currentStep);
  const reservation = useCheckinStore((s) => s.reservation);
  const guest = useCheckinStore((s) => s.guest);
  const selectedRoom = useCheckinStore((s) => s.selectedRoom);
  const selectedUpgrade = useCheckinStore((s) => s.selectedUpgrade);
  const pendingMessage = useCheckinStore((s) => s.pendingMessage);
  const setPendingMessage = useCheckinStore((s) => s.setPendingMessage);
  const processActions = useActionProcessor();

  /** Build context object to send with each chat message */
  const buildContext = useCallback((): Record<string, unknown> => {
    const ctx: Record<string, unknown> = { currentStep };
    if (reservation) ctx.reservation = reservation;
    if (guest) ctx.guest = guest;
    if (selectedRoom) ctx.selectedRoom = selectedRoom;
    if (selectedUpgrade) ctx.selectedUpgrade = selectedUpgrade;
    return ctx;
  }, [currentStep, reservation, guest, selectedRoom, selectedUpgrade]);

  /**
   * Shared handler for sending a user message to the AI.
   * Used by both the text form and the voice button (via onTranscript).
   */
  const handleSendMessage = useCallback(
    async (message: string) => {
      addMessage({ role: 'user', content: message });
      setLoading(true);

      try {
        const { reply, actions } = await sendChatMessage(message, sessionId, buildContext());
        addMessage({ role: 'assistant', content: reply });
        speak(reply);
        processActions(actions);
      } catch (err) {
        console.error('Chat failed:', err);
        setError('Failed to get response. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [addMessage, setLoading, setError, speak, sessionId, buildContext, processActions]
  );

  /**
   * Watch for pending messages from overlay screens (e.g. "Confirm" buttons).
   * When a screen sets pendingMessage, we auto-send it to the AI and clear it.
   */
  const pendingHandledRef = useRef(false);
  useEffect(() => {
    if (pendingMessage && !pendingHandledRef.current) {
      pendingHandledRef.current = true;
      handleSendMessage(pendingMessage).finally(() => {
        setPendingMessage(null);
        pendingHandledRef.current = false;
      });
    }
  }, [pendingMessage, handleSendMessage, setPendingMessage]);

  /** Handle text form submission */
  const handleTextSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!textInput.trim() || isLoading) return;

      const message = textInput.trim();
      setTextInput('');
      await handleSendMessage(message);
    },
    [textInput, isLoading, handleSendMessage]
  );

  return (
    <div className="glass-panel px-3 py-2 flex flex-col gap-1.5">
      {/* Compact transcript */}
      <TranscriptDisplay />

      {/* Input area — text field + voice button */}
      <div className="flex items-center gap-2">
        <form onSubmit={handleTextSubmit} className="flex-1">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type a message or tap the mic to talk hands-free..."
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-hotel-text placeholder-hotel-text-dim/50 focus:outline-none focus:border-hotel-accent/40 transition-colors"
            disabled={isLoading}
          />
        </form>
        <VoiceButton onTranscript={handleSendMessage} />
      </div>
    </div>
  );
}
