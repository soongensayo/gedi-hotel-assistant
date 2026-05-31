import axios from 'axios';
import type { GuestToStaffEvent, Reservation, ReservationProfile } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

export async function lookupReservation(query: string): Promise<Reservation | null> {
  const { data } = await api.get('/checkin/lookup', { params: { query } });
  return data;
}

export async function searchReservations(query: string): Promise<Reservation[]> {
  const { data } = await api.get<{ results: Reservation[] }>('/checkin/search', {
    params: { query, limit: 8 },
  });
  return data.results;
}

export async function getReservationProfile(
  reservationId: string
): Promise<ReservationProfile> {
  const { data } = await api.get<ReservationProfile>(
    `/checkin/profile/${encodeURIComponent(reservationId)}`
  );
  return data;
}

export async function recordStanfordEvent(params: {
  reservationId?: string;
  sessionKey: string;
  event: GuestToStaffEvent;
}): Promise<{ success: boolean; error?: string }> {
  const { data } = await api.post('/checkin/stanford-event', {
    reservationId: params.reservationId,
    sessionKey: params.sessionKey,
    eventType: params.event.type,
    eventPayload: sanitizeGuestEvent(params.event),
  });
  return data;
}

function sanitizeGuestEvent(event: GuestToStaffEvent): Record<string, unknown> {
  if (event.type === 'passport_scanned') {
    return {
      passportNumber: event.passportNumber,
      hasPassportPhoto: Boolean(event.photoDataUrl),
    };
  }

  if (event.type === 'signature_submitted') {
    return { signatureCaptured: Boolean(event.dataUrl) };
  }

  return { ...event };
}

export interface PassportScanStatus {
  status: 'idle' | 'scanning' | 'success' | 'failed';
  data?: {
    firstName: string;
    lastName: string;
    passportNumber: string;
    passportImageBase64?: string;
  };
  error?: string;
  attempts: number;
  elapsed: number;
}

export async function startPassportScan(): Promise<{ status: string }> {
  const { data } = await api.post('/checkin/start-passport-scan');
  return data;
}

export async function turnOnPassportGuide(): Promise<{ success: boolean }> {
  const { data } = await api.post('/checkin/passport-guide-on');
  return data;
}

export async function getPassportScanStatus(): Promise<PassportScanStatus> {
  const { data } = await api.get('/checkin/passport-scan-status');
  return data;
}

export async function stopPassportScan(): Promise<{ success: boolean }> {
  const { data } = await api.post('/checkin/stop-passport-scan');
  return data;
}

export async function activateNfc(): Promise<{ success: boolean; error?: string }> {
  const { data } = await api.post('/checkin/activate-nfc');
  return data;
}

export async function pollNfcStatus(): Promise<{
  detected: boolean;
  nfcUid?: string;
  last4?: string;
  receivedAt?: number;
}> {
  const { data } = await api.get('/checkin/nfc-status');
  return data;
}

export async function clearNfcStatus(): Promise<void> {
  await api.post('/checkin/nfc-clear');
}

export interface StanfordAvatarAction {
  type:
    | 'store_reservation'
    | 'capture_passport_photo'
    | 'show_reservation'
    | 'show_payment'
    | 'show_key_card'
    | 'end_session';
  payload?: Record<string, unknown>;
}

export interface StanfordAvatarChatResponse {
  reply: string;
  actions: StanfordAvatarAction[];
  sessionId: string;
}

export async function sendStanfordAvatarMessage(
  message: string,
  sessionId: string,
  context?: Record<string, unknown>
): Promise<StanfordAvatarChatResponse> {
  const { data } = await api.post('/stanford-avatar/chat', {
    message,
    sessionId,
    context,
  });
  return data;
}

export async function clearStanfordAvatarSession(sessionId: string): Promise<void> {
  await api.delete(`/stanford-avatar/chat/${encodeURIComponent(sessionId)}`);
}

export async function synthesizeSpeech(text: string): Promise<Blob> {
  const { data } = await api.post('/voice/tts', { text }, { responseType: 'blob' });
  return data;
}

export async function transcribeAudio(audioBlob: Blob): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  const { data } = await api.post('/voice/stt', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function savePassportPhoto(
  guestId: string,
  photoDataUrl: string
): Promise<{ success: boolean; error?: string }> {
  const passportImageBase64 = photoDataUrl.includes(',')
    ? photoDataUrl.split(',')[1]
    : photoDataUrl;
  const { data } = await api.post('/checkin/save-passport-photo', {
    guestId,
    passportImageBase64,
  });
  return data;
}

export interface IssueKeyCardRequest {
  guestName: string;
  roomNumber: string;
  cardLabel?: 'Primary' | 'Secondary';
}

export interface IssueKeyCardResponse {
  success: boolean;
  message?: string;
  uid?: string;
  code?: string;
  error?: string;
}

export type KeyCardHardwareAction = 'preload' | 'dispense';

export interface KeyCardHardwareActionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export async function issueKeyCard(
  body: IssueKeyCardRequest
): Promise<IssueKeyCardResponse> {
  const { data } = await api.post('/checkin/issue-key-card', body, {
    timeout: 120000,
  });
  return data;
}

export async function runKeyCardHardwareAction(
  action: KeyCardHardwareAction
): Promise<KeyCardHardwareActionResponse> {
  try {
    const { data } = await api.post('/checkin/key-card-hardware-action', { action }, {
      timeout: action === 'preload' ? 70000 : 55000,
    });
    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data;
      if (data && typeof data === 'object') {
        return data as KeyCardHardwareActionResponse;
      }
    }

    return {
      success: false,
      error: 'The key-card encoder is not reachable.',
    };
  }
}

export default api;
