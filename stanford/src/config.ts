export const STANFORD_ROOM_ID =
  (import.meta.env.VITE_STANFORD_ROOM_ID as string | undefined) ?? 'luxe-demo';

export const JITSI_DOMAIN =
  (import.meta.env.VITE_JITSI_DOMAIN as string | undefined) ?? 'meet.jit.si';

export const JITSI_APP_ID =
  (import.meta.env.VITE_JITSI_APP_ID as string | undefined) ?? '';

export const JITSI_JWT =
  (import.meta.env.VITE_JITSI_JWT as string | undefined) ?? '';

export const JITSI_PROVIDER_LABEL = JITSI_APP_ID
  ? 'JaaS'
  : JITSI_DOMAIN === 'meet.jit.si'
    ? 'Public Jitsi Meet'
    : `Jitsi (${JITSI_DOMAIN})`;

export function jitsiRoomName(roomId: string): string {
  const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const room = `LuxeDrive_Stanford_${safe}`;
  return JITSI_APP_ID ? `${JITSI_APP_ID}/${room}` : room;
}

export function jitsiExternalApiUrl(): string {
  const appPath = JITSI_APP_ID ? `/${JITSI_APP_ID}` : '';
  return `https://${JITSI_DOMAIN}${appPath}/external_api.js`;
}
