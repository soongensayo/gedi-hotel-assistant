import { io, type Socket } from 'socket.io-client';
import type { GuestToStaffEvent, JoinPayload, StaffToGuestCommand } from '../types';

const getBaseUrl = () => {
  if (import.meta.env.VITE_SOCKET_URL) {
    return import.meta.env.VITE_SOCKET_URL as string;
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
};

let socket: Socket | null = null;
let pendingJoin: JoinPayload | null = null;

export function getStanfordSocket(): Socket {
  if (!socket) {
    socket = io(`${getBaseUrl()}/stanford`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });

    socket.on('connect', () => {
      console.log('[Stanford Socket] Connected:', socket?.id);
      if (pendingJoin) {
        console.log('[Stanford Socket] Sending join:', pendingJoin);
        socket?.emit('stanford:join', pendingJoin);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[Stanford Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[Stanford Socket] Connection error:', err.message);
    });
  }
  return socket;
}

export function disconnectStanfordSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    pendingJoin = null;
  }
}

export function stanfordJoin(payload: JoinPayload): void {
  pendingJoin = payload;
  const s = getStanfordSocket();
  if (!s.connected) {
    s.connect();
  } else {
    console.log('[Stanford Socket] Already connected, joining immediately:', payload);
    s.emit('stanford:join', payload);
  }
}

export function emitStaffCommand(roomId: string, command: StaffToGuestCommand): void {
  const s = getStanfordSocket();
  if (!s.connected) {
    console.warn('[Stanford Socket] Not connected — command dropped');
    return;
  }
  s.emit('stanford:staff_command', { roomId, command });
}

export function emitGuestEvent(roomId: string, event: GuestToStaffEvent): void {
  const s = getStanfordSocket();
  if (!s.connected) {
    console.warn('[Stanford Socket] Not connected — event dropped');
    return;
  }
  s.emit('stanford:guest_event', { roomId, event });
}
