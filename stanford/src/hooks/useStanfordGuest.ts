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
  const [services, setServices] = useState<ServiceOffer[]>([]);
  const [customMessage, setCustomMessage] = useState<CustomMessageState | null>(null);
  const [passportScanMode, setPassportScanMode] = useState<'camera' | 'hardware'>('camera');

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
        case 'show_payment_qr':
          setPaymentQr({
            qrValue: command.qrValue,
            instructions: command.instructions,
          });
          setActiveScreen('payment');
          setCustomMessage(null);
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
          setPhase('media');
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
    services,
    customMessage,
    passportScanMode,
    sendToStaff,
  };
}
