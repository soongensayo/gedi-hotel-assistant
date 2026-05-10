import axios from 'axios';
import type { Reservation } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

export async function lookupReservation(query: string): Promise<Reservation | null> {
  const { data } = await api.get('/checkin/lookup', { params: { query } });
  return data;
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

export default api;
