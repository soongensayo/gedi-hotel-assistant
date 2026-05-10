/// <reference types="vite/client" />

interface JitsiMeetExternalAPIOptions {
  roomName: string;
  width?: string | number;
  height?: string | number;
  parentNode: HTMLElement;
  configOverwrite?: Record<string, unknown>;
  interfaceConfigOverwrite?: Record<string, unknown>;
  userInfo?: { displayName?: string };
}

declare class JitsiMeetExternalAPI {
  constructor(domain: string, options: JitsiMeetExternalAPIOptions);
  dispose(): void;
  executeCommand(command: string, ...args: unknown[]): void;
}

interface Window {
  JitsiMeetExternalAPI?: typeof JitsiMeetExternalAPI;
}
