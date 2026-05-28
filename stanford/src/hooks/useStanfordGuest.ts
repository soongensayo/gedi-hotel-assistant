import { useCallback, useEffect, useState } from 'react';
import type {
  GuestPhase,
  GuestScreenId,
  GuestToStaffEvent,
  Reservation,
  ServiceOffer,
  StaffToGuestCommand,
} from '../types';
import {
  emitGuestEvent,
  getStanfordSocket,
  stanfordJoin,
} from '../services/socket';

export interface PaymentQrState {
  qrValue: string;
  instructions?: string;
}

export interface CustomMessageState {
  title?: string;
  body: string;
}

export function useStanfordGuest(roomId: string) {
  const [phase, setPhase] = useState<GuestPhase>('welcome');
  const [activeScreen, setActiveScreen] = useState<GuestScreenId>('video-only');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [paymentQr, setPaymentQr] = useState<PaymentQrState | null>(null);
  const [paymentSuccessRequestId, setPaymentSuccessRequestId] = useState(0);
  const [services, setServices] = useState<ServiceOffer[]>([]);
  const [customMessage, setCustomMessage] = useState<CustomMessageState | null>(null);
  const [passportScanMode, setPassportScanMode] = useState<'camera' | 'hardware'>('camera');
  const [passportCaptureRequestId, setPassportCaptureRequestId] = useState(0);

  const sendToStaff = useCallback(
    (event: GuestToStaffEvent) => {
      emitGuestEvent(roomId, event);
    },
    [roomId]
  );

  useEffect(() => {
    const socket = getStanfordSocket();

    const onCommand = (command: StaffToGuestCommand) => {
      console.log('[Guest] Received command:', command.type, command);

      // Auto-transition to concierge phase when any staff command arrives
      if (command.type !== 'end_session') {
        setPhase((prev) => (prev !== 'concierge' ? 'concierge' : prev));
      }

      switch (command.type) {
        case 'show_screen':
          setActiveScreen(command.screen);
          setCustomMessage(null);
          break;
        case 'show_reservation':
          setReservation(command.reservation);
          setActiveScreen('reservation');
          setCustomMessage(null);
          break;
        case 'activate_passport_scan':
          setPassportScanMode(command.mode ?? 'camera');
          setActiveScreen('passport');
          setCustomMessage(null);
          break;
        case 'capture_passport_camera':
          setPassportCaptureRequestId((current) => current + 1);
          break;
        case 'show_payment_qr':
          setPaymentQr({
            qrValue: command.qrValue,
            instructions: command.instructions,
          });
          setActiveScreen('payment');
          setCustomMessage(null);
          break;
        case 'payment_success_demo':
          setPaymentQr((current) => current ?? {
            qrValue: 'demo-payment-complete',
            instructions: 'Payment is being confirmed by your concierge.',
          });
          setActiveScreen('payment');
          setCustomMessage(null);
          setPaymentSuccessRequestId((current) => current + 1);
          break;
        case 'request_signature':
          setActiveScreen('signature');
          setCustomMessage(null);
          break;
        case 'dispense_key_card':
          setActiveScreen('key-card');
          setCustomMessage(null);
          break;
        case 'show_services':
          setServices(command.services);
          setActiveScreen('services');
          setCustomMessage(null);
          break;
        case 'show_map':
          setActiveScreen('property-tour');
          setCustomMessage(null);
          break;
        case 'end_session':
          setPhase('checkin-complete');
          setActiveScreen('video-only');
          setCustomMessage(null);
          break;
        case 'custom_message':
          setCustomMessage({ title: command.title, body: command.body });
          setActiveScreen('custom');
          break;
        default:
          break;
      }
    };

    // Register listener BEFORE connecting so we don't miss events
    socket.on('stanford:guest_command', onCommand);

    // Join as guest (handles connect + re-join on reconnect)
    stanfordJoin({ role: 'guest', roomId });

    return () => {
      socket.off('stanford:guest_command', onCommand);
    };
  }, [roomId]);

  useEffect(() => {
    if (phase === 'concierge') {
      sendToStaff({
        type: 'screen_changed',
        phase,
        screen: activeScreen,
      });
    }
  }, [phase, activeScreen, sendToStaff]);

  return {
    phase,
    setPhase,
    activeScreen,
    setActiveScreen,
    reservation,
    setReservation,
    paymentQr,
    setPaymentQr,
    paymentSuccessRequestId,
    services,
    customMessage,
    passportScanMode,
    passportCaptureRequestId,
    sendToStaff,
  };
}
