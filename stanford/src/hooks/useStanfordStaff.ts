import { useCallback, useEffect, useState } from 'react';
import type { GuestPhase, GuestScreenId, GuestToStaffEvent, StaffEventLogEntry } from '../types';
import { emitStaffCommand, getStanfordSocket, stanfordJoin } from '../services/socket';
import type { StaffToGuestCommand } from '../types';

let logCounter = 0;

export function useStanfordStaff(roomId: string) {
  const [guestPhase, setGuestPhase] = useState<GuestPhase | null>(null);
  const [guestScreen, setGuestScreen] = useState<GuestScreenId | null>(null);
  const [lastGuestEvent, setLastGuestEvent] = useState<GuestToStaffEvent | null>(null);
  const [eventLog, setEventLog] = useState<StaffEventLogEntry[]>([]);

  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
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
      emitStaffCommand(roomId, command);
    },
    [roomId]
  );

  useEffect(() => {
    const socket = getStanfordSocket();

    const onGuestEvent = (event: GuestToStaffEvent) => {
      console.log('[Staff] Received guest event:', event.type, event);
      setLastGuestEvent(event);

      const entry: StaffEventLogEntry = {
        id: `log-${++logCounter}`,
        ts: Date.now(),
        event,
      };
      setEventLog((prev) => [entry, ...prev].slice(0, 100));

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
    lastGuestEvent,
    eventLog,
    pushCommand,
    signatureDataUrl,
    passportPhotoUrl,
    passportNumber,
    preferences,
    selectedServices,
    luggageInfo,
  };
}
