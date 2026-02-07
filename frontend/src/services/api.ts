import axios from 'axios';
import type { Room, Reservation, HotelInfo, RoomUpgrade, PassportScanResult, PaymentResult } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// --- Chat ---

export async function sendChatMessage(
  message: string,
  sessionId: string,
  context?: Record<string, unknown>
): Promise<{ reply: string; audioUrl?: string }> {
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

export async function completeCheckin(
  reservationId: string,
  roomId: string
): Promise<{ keyCardNumber: string; roomNumber: string }> {
  const { data } = await api.post('/checkin/complete', {
    reservationId,
    roomId,
  });
  return data;
}

export default api;
