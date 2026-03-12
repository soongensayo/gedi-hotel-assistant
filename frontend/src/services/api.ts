import axios from 'axios';
import type { Room, Reservation, HotelInfo, RoomUpgrade, PassportScanResult, PaymentResult } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// --- Types for AI actions ---

export interface AIAction {
  type:
    | 'set_step'
    | 'show_passport_scanner'
    | 'skip_passport_scanner'
    | 'show_payment'
    | 'show_key_card'
    | 'store_reservation';
  payload?: Record<string, unknown>;
}

export interface ChatResponse {
  reply: string;
  actions: AIAction[];
  sessionId: string;
}

// --- Chat ---

export async function sendChatMessage(
  message: string,
  sessionId: string,
  context?: Record<string, unknown>
): Promise<ChatResponse> {
  const { data } = await api.post('/chat', { message, sessionId, context });
  return data;
}

// --- Voice ---

export async function transcribeAudio(audioBlob: Blob): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  const { data } = await api.post('/voice/stt', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function synthesizeSpeech(text: string): Promise<Blob> {
  const { data } = await api.post('/voice/tts', { text }, { responseType: 'blob' });
  return data;
}

// --- Avatar ---

export async function triggerAvatarSpeak(
  text: string,
  audioUrl?: string
): Promise<{ videoUrl?: string; sessionToken?: string }> {
  const { data } = await api.post('/avatar/speak', { text, audioUrl });
  return data;
}

// --- Hotel Data ---

export async function getHotelInfo(): Promise<HotelInfo> {
  const { data } = await api.get('/hotel/info');
  return data;
}

export async function getAvailableRooms(
  checkIn?: string,
  checkOut?: string
): Promise<Room[]> {
  const { data } = await api.get('/hotel/rooms', {
    params: { checkIn, checkOut },
  });
  return data;
}

export async function getRoomUpgrades(roomType: string): Promise<RoomUpgrade[]> {
  const { data } = await api.get('/hotel/upgrades', {
    params: { roomType },
  });
  return data;
}

// --- Check-in ---

export async function lookupReservation(
  query: string
): Promise<Reservation | null> {
  const { data } = await api.get('/checkin/lookup', {
    params: { query },
  });
  return data;
}

export async function lookupReservationByPassport(
  passportNumber: string
): Promise<Reservation | null> {
  const { data } = await api.get('/checkin/lookup-passport', {
    params: { passportNumber },
  });
  return data;
}

export async function scanPassport(): Promise<PassportScanResult> {
  const { data } = await api.post('/checkin/scan-passport');
  return data;
}

// --- Async passport scanning (polling architecture) ---

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

export async function getPassportScanStatus(): Promise<PassportScanStatus> {
  const { data } = await api.get('/checkin/passport-scan-status');
  return data;
}

export async function stopPassportScan(): Promise<{ success: boolean }> {
  const { data } = await api.post('/checkin/stop-passport-scan');
  return data;
}

export async function savePassportData(
  guestId: string,
  passportName: string,
  passportNumber: string,
  passportImageBase64?: string
): Promise<{ success: boolean }> {
  const { data } = await api.post('/checkin/save-passport-data', {
    guestId,
    passportName,
    passportNumber,
    passportImageBase64,
  });
  return data;
}

export async function processPayment(
  reservationId: string,
  amount: number,
  currency: string
): Promise<PaymentResult> {
  const { data } = await api.post('/checkin/process-payment', {
    reservationId,
    amount,
    currency,
  });
  return data;
}

export interface CompleteCheckinParams {
  reservationId: string;
  roomId: string;
  guestEmail?: string;
  guestName?: string;
  roomNumber?: string;
  roomType?: string;
  floor?: number;
  checkInDate?: string;
  checkOutDate?: string;
  confirmationCode?: string;
}

export async function completeCheckin(
  params: CompleteCheckinParams
): Promise<{ keyCardNumber: string; roomNumber: string; digitalKeySent: boolean }> {
  const { data } = await api.post('/checkin/complete', params);
  return data;
}

// --- NFC Card Reader ---

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

export default api;
