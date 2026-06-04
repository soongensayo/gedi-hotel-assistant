import { useCallback, useEffect, useRef, useState } from 'react';
import { AmbientJazz } from '../components/AmbientJazz';
import { GuestPortraitShell } from '../components/GuestPortraitShell';
import { ScreenOverlay } from '../components/ScreenOverlay';
import { CheckinCompleteScreen } from '../screens/CheckinCompleteScreen';
import { PaymentScreen } from '../screens/PaymentScreen';
import { ReservationScreen } from '../screens/ReservationScreen';
import {
  clearStanfordAvatarSession,
  savePassportPhoto,
  sendStanfordAvatarMessage,
  type StanfordAvatarAction,
} from '../services/api';
import type { GuestScreenId, Reservation } from '../types';
import { AutoPassportCaptureScreen } from './AutoPassportCaptureScreen';
import { AvatarKeyCardScreen } from './AvatarKeyCardScreen';
import {
  StanfordAvatarChatPanel,
  type AvatarMessage,
} from './StanfordAvatarChatPanel';
import { StanfordAvatarDisplay } from './StanfordAvatarDisplay';
import type { SimliAudioClient } from './useStanfordVoiceOutput';
import { useStanfordVoiceOutput } from './useStanfordVoiceOutput';

type AvatarScreen = Extract<
  GuestScreenId,
  'reservation' | 'passport' | 'payment' | 'key-card'
> | null;

const fallbackKeyGuest =
  (import.meta.env.VITE_STANFORD_KEY_GUEST as string | undefined) ?? 'Stanford Guest';
const fallbackKeyRoom =
  (import.meta.env.VITE_STANFORD_KEY_ROOM as string | undefined) ?? '311';
const GUEST_THEME_STORAGE_KEY = 'stanford-guest-wood-theme';

export function AvatarGuestApp() {
  const [activeScreen, setActiveScreen] = useState<AvatarScreen>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [paymentQr, setPaymentQr] = useState<{
    qrValue: string;
    instructions?: string;
  } | null>(null);
  const [messages, setMessages] = useState<AvatarMessage[]>([
    {
      id: 'avatar-welcome',
      role: 'avatar',
      content: 'Welcome. I can help you check in with your name or confirmation code.',
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [passportPhotoCaptured, setPassportPhotoCaptured] = useState(false);
  const [passportVerifying, setPassportVerifying] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [keyCardReceived, setKeyCardReceived] = useState(false);
  const [woodThemeActive, setWoodThemeActive] = useState(() => {
    try {
      return window.localStorage.getItem(GUEST_THEME_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const sessionIdRef = useRef(`stanford-avatar-${Date.now()}`);
  const avatarClientRef = useRef<SimliAudioClient | null>(null);
  const avatarConnectedRef = useRef(false);
  const transitionTimersRef = useRef<number[]>([]);

  const { isSpeaking, speak, stop } = useStanfordVoiceOutput({
    getAvatarClient: () => avatarClientRef.current,
    isAvatarConnected: () => avatarConnectedRef.current,
  });

  const clearTransitionTimers = useCallback(() => {
    transitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    transitionTimersRef.current = [];
  }, []);

  const scheduleTransition = useCallback(
    (callback: () => void, delayMs: number) => {
      const timer = window.setTimeout(() => {
        transitionTimersRef.current = transitionTimersRef.current.filter((id) => id !== timer);
        callback();
      }, delayMs);
      transitionTimersRef.current.push(timer);
    },
    []
  );

  useEffect(() => clearTransitionTimers, [clearTransitionTimers]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        GUEST_THEME_STORAGE_KEY,
        String(woodThemeActive)
      );
    } catch {
      // Theme persistence is a nicety; the visible toggle should still work.
    }
  }, [woodThemeActive]);

  const resetSession = useCallback(() => {
    stop();
    clearTransitionTimers();
    const previousSessionId = sessionIdRef.current;
    void clearStanfordAvatarSession(previousSessionId).catch(() => {});
    sessionIdRef.current = `stanford-avatar-${Date.now()}`;
    setActiveScreen(null);
    setReservation(null);
    setPaymentQr(null);
    setBusy(false);
    setComplete(false);
    setPassportPhotoCaptured(false);
    setPassportVerifying(false);
    setPaymentComplete(false);
    setKeyCardReceived(false);
    setMessages([
      {
        id: `avatar-welcome-${Date.now()}`,
        role: 'avatar',
        content: 'Welcome. I can help you check in with your name or confirmation code.',
      },
    ]);
  }, [clearTransitionTimers, stop]);

  const appendMessage = useCallback((role: AvatarMessage['role'], content: string) => {
    setMessages((current) => [
      ...current,
      { id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`, role, content },
    ]);
  }, []);

  const buildContext = useCallback(
    () => ({
      mode: 'stanford-avatar',
      reservation,
      guest: reservation?.guest,
      room: reservation?.room,
      activeScreen,
      passportPhotoCaptured,
      paymentComplete,
      keyCardReceived,
    }),
    [
      activeScreen,
      keyCardReceived,
      passportPhotoCaptured,
      paymentComplete,
      reservation,
    ]
  );

  const processActions = useCallback((actions: StanfordAvatarAction[]) => {
    for (const action of actions) {
      switch (action.type) {
        case 'store_reservation':
          setReservation(action.payload as unknown as Reservation);
          break;
        case 'capture_passport_photo':
          setPassportVerifying(false);
          scheduleTransition(() => setActiveScreen('passport'), 900);
          break;
        case 'show_reservation':
          scheduleTransition(() => setActiveScreen('reservation'), 900);
          break;
        case 'show_payment':
          setPaymentQr({
            qrValue: String(action.payload?.qrValue ?? 'avatar-payment-demo'),
            instructions:
              typeof action.payload?.instructions === 'string'
                ? action.payload.instructions
                : 'Tap your card or phone on the NFC reader to complete payment.',
          });
          scheduleTransition(() => setActiveScreen('payment'), 1100);
          break;
        case 'show_key_card':
          scheduleTransition(() => setActiveScreen('key-card'), 1300);
          break;
        case 'end_session':
          scheduleTransition(() => {
            setActiveScreen(null);
            setComplete(true);
          }, 1400);
          break;
        default:
          break;
      }
    }
  }, [scheduleTransition]);

  const sendMessage = useCallback(
    async (message: string, options?: { visible?: boolean }) => {
      if (busy) return;
      const visible = options?.visible ?? true;
      if (visible) appendMessage('guest', message);
      setBusy(true);
      try {
        const response = await sendStanfordAvatarMessage(
          message,
          sessionIdRef.current,
          buildContext()
        );
        sessionIdRef.current = response.sessionId;
        appendMessage('avatar', response.reply);
        processActions(response.actions);
        void speak(response.reply);
      } catch (error) {
        console.error('[Stanford Avatar] Chat failed:', error);
        appendMessage('avatar', 'I had trouble reaching the concierge brain. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [appendMessage, buildContext, busy, processActions, speak]
  );

  const completePassportCapture = useCallback(
    async (_passportNumber?: string, photoDataUrl?: string) => {
      setPassportVerifying(true);
      if (photoDataUrl && reservation?.guestId) {
        try {
          await savePassportPhoto(reservation.guestId, photoDataUrl);
        } catch (error) {
          console.warn('[Stanford Avatar] Passport photo upload failed:', error);
        }
      }
      scheduleTransition(() => {
        setPassportPhotoCaptured(true);
        void sendMessage('Passport photo captured successfully for identity verification.', {
          visible: false,
        });
      }, 2400);
    },
    [reservation?.guestId, scheduleTransition, sendMessage]
  );

  const guestName = reservation?.guest
    ? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim()
    : fallbackKeyGuest;
  const roomNumber = reservation?.room?.roomNumber ?? fallbackKeyRoom;
  const keyCardIssueKey = `${sessionIdRef.current}:${reservation?.id ?? 'fallback'}:${guestName}:${roomNumber}`;
  const guestThemeClassName = woodThemeActive ? 'guest-interface guest-theme-wood' : 'guest-interface';
  const themeControls = (
    <AmbientJazz
      enabled
      woodThemeActive={woodThemeActive}
      onToggleWoodTheme={() => setWoodThemeActive((current) => !current)}
    />
  );

  const overlayContent = () => {
    switch (activeScreen) {
      case 'passport':
        return (
          <AutoPassportCaptureScreen
            verifying={passportVerifying}
            onComplete={completePassportCapture}
          />
        );
      case 'reservation':
        return reservation ? (
          <ReservationScreen
            reservation={reservation}
            onConfirm={() => void sendMessage('Yes, I confirm this reservation.')}
          />
        ) : (
          <p className="py-8 text-center text-white/70">Reservation details loading...</p>
        );
      case 'payment':
        return paymentQr ? (
          <PaymentScreen
            qrValue={paymentQr.qrValue}
            instructions={paymentQr.instructions}
            onPaidDemo={() => {
              setPaymentComplete(true);
              void sendMessage('Payment completed successfully by NFC tap.', {
                visible: false,
              });
            }}
          />
        ) : (
          <p className="py-8 text-center text-white/70">Payment instructions loading...</p>
        );
      case 'key-card':
        return (
          <AvatarKeyCardScreen
            issueKey={keyCardIssueKey}
            guestName={guestName}
            roomNumber={roomNumber}
            onReceived={() => {
              setKeyCardReceived(true);
              void sendMessage('The key card has been issued and received.', {
                visible: false,
              });
            }}
          />
        );
      default:
        return null;
    }
  };

  if (complete) {
    return (
      <div className={`relative h-full w-full ${guestThemeClassName}`}>
        {themeControls}
        <button
          type="button"
          onClick={resetSession}
          className="absolute left-5 top-5 z-30 rounded-full border border-[var(--color-hotel-border)] bg-[var(--guest-card-strong)] px-3 py-1.5 text-[10px] uppercase tracking-widest text-[var(--color-hotel-text-dim)] shadow-[0_10px_28px_rgba(31,106,88,0.12)] transition hover:border-[var(--color-hotel-accent)] hover:text-[var(--color-hotel-text)] md:left-8 md:top-8"
        >
          Restart session
        </button>
        <CheckinCompleteScreen
          reservation={reservation}
          onContinue={() => {
            setComplete(false);
            void sendMessage('I would like concierge help after check-in.');
          }}
        />
      </div>
    );
  }

  return (
    <div className={`h-full w-full ${guestThemeClassName}`}>
      {themeControls}
      <GuestPortraitShell
        showcaseOverlay={
          <ScreenOverlay open={Boolean(activeScreen)}>
            <div key={activeScreen} className="avatar-step-enter">
              {overlayContent()}
            </div>
          </ScreenOverlay>
        }
      >
        <div className="guest-call-surface relative flex h-full w-full flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1">
            <StanfordAvatarDisplay
              thinking={busy}
              speaking={isSpeaking}
              onClientChange={(client, connected) => {
                avatarClientRef.current = client;
                avatarConnectedRef.current = connected;
              }}
            />
            <div className="pointer-events-none absolute left-5 top-16 z-10 max-w-lg text-white md:left-8 md:top-20">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-hotel-gold)]">
                Avatar check-in
              </p>
              <h1 className="mt-2 text-2xl leading-tight md:text-4xl">
                PrimeDrive is ready to check you in.
              </h1>
            </div>
            <button
              type="button"
              onClick={resetSession}
              className="absolute left-5 top-5 z-20 rounded-full border border-white/14 bg-white/8 px-3 py-1.5 text-[10px] uppercase tracking-widest text-white/68 backdrop-blur-md transition hover:border-[var(--color-hotel-gold)]/45 hover:text-[#f8f1df] md:left-8 md:top-8"
            >
              Restart session
            </button>
          </div>
          <StanfordAvatarChatPanel
            messages={messages}
            busy={busy}
            speaking={isSpeaking}
            onSend={sendMessage}
            onInterrupt={stop}
          />
        </div>
      </GuestPortraitShell>
    </div>
  );
}
