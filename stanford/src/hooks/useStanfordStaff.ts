import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuestPhase, GuestScreenId, GuestToStaffEvent, Reservation, StaffEventLogEntry } from '../types';
import { recordStanfordEvent } from '../services/api';
import { emitStaffCommand, getStanfordSocket, stanfordJoin } from '../services/socket';
import type { StaffToGuestCommand } from '../types';

let logCounter = 0;

export function useStanfordStaff(roomId: string) {
  const [guestPhase, setGuestPhase] = useState<GuestPhase | null>(null);
  const [guestScreen, setGuestScreen] = useState<GuestScreenId | null>(null);
  const [lastGuestEvent, setLastGuestEvent] = useState<GuestToStaffEvent | null>(null);
  const [eventLog, setEventLog] = useState<StaffEventLogEntry[]>([]);
  const [activeReservation, setActiveReservation] = useState<Reservation | null>(null);
  const activeReservationRef = useRef<Reservation | null>(null);

  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [passportLivePreviewUrl, setPassportLivePreviewUrl] = useState<string | null>(null);
  const [passportPhotoUrl, setPassportPhotoUrl] = useState<string | null>(null);
  const [passportNumber, setPassportNumber] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<{
    temperature: number;
    pillows: string;
    celebration?: string;
  } | null>(null);
  const [selectedServices, setSelectedServices] = useState<{ id: string; label: string }[]>([]);
  const [luggageInfo, setLuggageInfo] = useState<{
    count: number;
    needsHelp: boolean;
    etaNote?: string;
  } | null>(null);

  const pushCommand = useCallback(
    (command: StaffToGuestCommand) => {
      if (command.type === 'show_reservation') {
        activeReservationRef.current = command.reservation;
        setActiveReservation(command.reservation);
      }
      if (command.type === 'activate_passport_scan' && command.mode === 'camera') {
        setPassportLivePreviewUrl(null);
      }
      emitStaffCommand(roomId, command);
    },
    [roomId]
  );

  useEffect(() => {
    const socket = getStanfordSocket();

    const onGuestEvent = (event: GuestToStaffEvent) => {
      console.log('[Staff] Received guest event:', event.type, event);

      if (event.type === 'passport_camera_preview') {
        setPassportLivePreviewUrl(event.photoDataUrl);
        return;
      }

      setLastGuestEvent(event);

      const entry: StaffEventLogEntry = {
        id: `log-${++logCounter}`,
        ts: Date.now(),
        event,
      };
      setEventLog((prev) => [entry, ...prev].slice(0, 100));

      void recordStanfordEvent({
        reservationId: activeReservationRef.current?.id,
        sessionKey: roomId,
        event,
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.warn('[Staff] Failed to persist Stanford event:', message);
      });

      switch (event.type) {
        case 'screen_changed':
          setGuestPhase(event.phase);
          setGuestScreen(event.screen);
          break;
        case 'signature_submitted':
          setSignatureDataUrl(event.dataUrl);
          break;
        case 'passport_scanned':
          if (event.photoDataUrl) setPassportPhotoUrl(event.photoDataUrl);
          if (event.passportNumber) setPassportNumber(event.passportNumber);
          setPassportLivePreviewUrl(null);
          break;
        case 'preferences_submitted':
          setPreferences({
            temperature: event.temperature,
            pillows: event.pillows,
            celebration: event.celebration,
          });
          break;
        case 'service_selected':
          setSelectedServices((prev) => [
            ...prev,
            { id: event.serviceId, label: event.label },
          ]);
          break;
        case 'luggage_info':
          setLuggageInfo({
            count: event.count,
            needsHelp: event.needsHelp,
            etaNote: event.etaNote,
          });
          break;
        default:
          break;
      }
    };

    // Register listener BEFORE connecting
    socket.on('stanford:staff_event', onGuestEvent);

    // Join as staff
    stanfordJoin({ role: 'staff', roomId });

    return () => {
      socket.off('stanford:staff_event', onGuestEvent);
    };
  }, [roomId]);

  return {
    guestPhase,
    guestScreen,
    activeReservation,
    lastGuestEvent,
    eventLog,
    pushCommand,
    signatureDataUrl,
    passportLivePreviewUrl,
    passportPhotoUrl,
    passportNumber,
    preferences,
    selectedServices,
    luggageInfo,
  };
}
