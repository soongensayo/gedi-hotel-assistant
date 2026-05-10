export const STANFORD_ROOM_ID =
  (import.meta.env.VITE_STANFORD_ROOM_ID as string | undefined) ?? 'luxe-demo';

export const JITSI_DOMAIN = 'meet.jit.si';

export function jitsiRoomName(roomId: string): string {
  const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `LuxeDrive_Stanford_${safe}`;
}
