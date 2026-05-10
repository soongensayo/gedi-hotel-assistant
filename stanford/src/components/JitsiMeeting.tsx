import { useEffect, useRef } from 'react';
import { JITSI_DOMAIN } from '../config';

type Props = {
  roomName: string;
  displayName: string;
  isGuest: boolean;
};

export function JitsiMeeting({ roomName, displayName, isGuest }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiMeetExternalAPI | null>(null);

  useEffect(() => {
    let cancelled = false;
    const containerEl = containerRef.current;

    const mount = () => {
      const Jitsi = window.JitsiMeetExternalAPI;
      const el = containerRef.current;
      if (!Jitsi || !el) return;

      apiRef.current?.dispose();
      apiRef.current = null;
      el.innerHTML = '';

      const api = new Jitsi(JITSI_DOMAIN, {
        roomName,
        parentNode: el,
        width: '100%',
        height: '100%',
        userInfo: { displayName },
        configOverwrite: {
          prejoinPageEnabled: false,
        },
        interfaceConfigOverwrite: {
          TOOLBAR_BUTTONS: isGuest
            ? []
            : ['microphone', 'camera', 'hangup', 'tileview'],
        },
      });
      apiRef.current = api;
    };

    const ensureScript = () => {
      if (window.JitsiMeetExternalAPI) {
        mount();
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-jitsi-external-api]'
      );
      if (existing) {
        existing.addEventListener('load', () => {
          if (!cancelled) mount();
        });
        return;
      }
      const script = document.createElement('script');
      script.src = `https://${JITSI_DOMAIN}/external_api.js`;
      script.async = true;
      script.dataset.jitsiExternalApi = 'true';
      script.onload = () => {
        if (!cancelled) mount();
      };
      document.body.appendChild(script);
    };

    ensureScript();

    return () => {
      cancelled = true;
      apiRef.current?.dispose();
      apiRef.current = null;
      if (containerEl) containerEl.innerHTML = '';
    };
  }, [roomName, displayName, isGuest]);

  return <div ref={containerRef} className="h-full w-full min-h-[200px] bg-black" />;
}
