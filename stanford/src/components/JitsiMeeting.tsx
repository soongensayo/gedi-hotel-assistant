import { useCallback, useEffect, useRef, useState } from 'react';
import {
  JITSI_DOMAIN,
  JITSI_JWT,
  JITSI_PROVIDER_LABEL,
  jitsiExternalApiUrl,
} from '../config';

type Props = {
  roomName: string;
  displayName: string;
  isGuest: boolean;
};

type MeetingState = 'loading' | 'connecting' | 'ready' | 'warning' | 'error';
type BackgroundState = 'idle' | 'applying' | 'on' | 'off' | 'failed';

type VideoIssue = {
  title: string;
  body: string;
  actions: string[];
};

const STAFF_VIRTUAL_BACKGROUND_URL = '/images/staff-virtual-background.jpg';
let staffVirtualBackgroundDataUrl: string | null = null;

function isLoopbackHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function getBrowserVideoIssue(): VideoIssue | null {
  if (typeof window === 'undefined') return null;

  const hasPeerConnection = 'RTCPeerConnection' in window;
  const hasMediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
  const isLocal = isLoopbackHost(window.location.hostname);
  const isSecure = window.isSecureContext || isLocal;

  if (!hasPeerConnection) {
    return {
      title: 'This browser does not expose WebRTC.',
      body: 'The call needs a current Chrome, Edge, Firefox, or Safari build with WebRTC enabled.',
      actions: ['Open the staff panel in Chrome or Edge.', 'Disable privacy extensions for this demo origin.'],
    };
  }

  if (!isSecure || !hasMediaDevices) {
    return {
      title: 'Camera and microphone are blocked on this origin.',
      body: `You are viewing ${window.location.origin}. Browsers only expose camera and microphone on HTTPS or localhost, even when site permissions look allowed.`,
      actions: [
        'Use https for the LAN demo URL.',
        'Use localhost when staff runs on the same machine.',
        'For a quick demo tunnel, use ngrok or a trusted local certificate.',
      ],
    };
  }

  return null;
}

function getInitialMeetingReadiness() {
  const issue = getBrowserVideoIssue();
  return {
    issue,
    state: (issue ? 'warning' : 'loading') as MeetingState,
  };
}

async function fetchJitsiToken({
  roomName,
  displayName,
  isGuest,
}: {
  roomName: string;
  displayName: string;
  isGuest: boolean;
}) {
  if (JITSI_JWT || JITSI_DOMAIN !== '8x8.vc') return JITSI_JWT;

  const response = await fetch('/api/jitsi/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomName,
      displayName,
      role: isGuest ? 'guest' : 'staff',
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Could not get JaaS token from backend.');
  }

  return String(data.token || '');
}

async function loadStaffVirtualBackground(): Promise<string> {
  if (staffVirtualBackgroundDataUrl) return staffVirtualBackgroundDataUrl;

  const response = await fetch(STAFF_VIRTUAL_BACKGROUND_URL);
  if (!response.ok) {
    throw new Error('Could not load staff virtual background.');
  }

  const blob = await response.blob();
  staffVirtualBackgroundDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return staffVirtualBackgroundDataUrl;
}

export function JitsiMeeting({ roomName, displayName, isGuest }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiMeetExternalAPI | null>(null);
  const [readiness] = useState(getInitialMeetingReadiness);
  const [meetingState, setMeetingState] = useState<MeetingState>(readiness.state);
  const videoIssue = readiness.issue;
  const [errorDetail, setErrorDetail] = useState('');
  const [staffBackgroundEnabled, setStaffBackgroundEnabled] = useState(!isGuest);
  const [staffBackgroundState, setStaffBackgroundState] = useState<BackgroundState>(
    isGuest ? 'idle' : 'applying'
  );

  const applyStaffBackground = useCallback(
    async (api: JitsiMeetExternalAPI, enabled: boolean) => {
      if (isGuest) return;
      setStaffBackgroundState('applying');

      try {
        if (!enabled) {
          api.executeCommand('setVirtualBackground', false, '');
          setStaffBackgroundState('off');
          return;
        }

        const backgroundImage = await loadStaffVirtualBackground();
        api.executeCommand('setVirtualBackground', true, backgroundImage);
        setStaffBackgroundState('on');
      } catch {
        setStaffBackgroundState('failed');
      }
    },
    [isGuest]
  );

  const toggleStaffBackground = () => {
    if (isGuest || !apiRef.current) return;
    const nextEnabled = staffBackgroundState === 'failed' ? true : !staffBackgroundEnabled;
    setStaffBackgroundEnabled(nextEnabled);
    void applyStaffBackground(apiRef.current, nextEnabled);
  };

  useEffect(() => {
    let cancelled = false;
    const containerEl = containerRef.current;
    const externalApiUrl = jitsiExternalApiUrl();

    const mount = async () => {
      const Jitsi = window.JitsiMeetExternalAPI;
      const el = containerRef.current;
      if (!Jitsi || !el) return;

      apiRef.current?.dispose();
      apiRef.current = null;
      el.innerHTML = '';

      let jwt = JITSI_JWT;
      try {
        jwt = await fetchJitsiToken({ roomName, displayName, isGuest });
      } catch (error) {
        if (!cancelled) {
          setMeetingState('error');
          setErrorDetail(error instanceof Error ? error.message : 'Could not prepare Jitsi token.');
        }
        return;
      }

      const api = new Jitsi(JITSI_DOMAIN, {
        roomName,
        parentNode: el,
        width: '100%',
        height: '100%',
        ...(jwt ? { jwt } : {}),
        userInfo: { displayName },
        configOverwrite: {
          prejoinPageEnabled: false,
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          disableDeepLinking: true,
          doNotFlipLocalVideo: false,
        },
        interfaceConfigOverwrite: {
          TOOLBAR_BUTTONS: isGuest
            ? []
            : ['microphone', 'camera', 'hangup', 'tileview'],
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          SHOW_BRAND_WATERMARK: false,
          SHOW_POWERED_BY: false,
          SHOW_CHROME_EXTENSION_BANNER: false,
          TILE_VIEW_ENABLED: !isGuest,
          VERTICAL_FILMSTRIP: !isGuest,
        },
      });

      const iframe = el.querySelector('iframe');
      iframe?.setAttribute(
        'allow',
        'camera; microphone; fullscreen; display-capture; autoplay'
      );

      setMeetingState(videoIssue ? 'warning' : 'ready');

      api.on('videoConferenceJoined', () => {
        if (!cancelled) setMeetingState('ready');
        if (!isGuest) void applyStaffBackground(api, true);
      });
      api.on('cameraError', (...details) => {
        if (!cancelled) {
          setMeetingState('error');
          setErrorDetail(`Camera failed: ${details.map(String).join(' ')}`);
        }
      });
      api.on('micError', (...details) => {
        if (!cancelled) {
          setMeetingState('error');
          setErrorDetail(`Microphone failed: ${details.map(String).join(' ')}`);
        }
      });
      api.on('errorOccurred', (event) => {
        if (!cancelled) {
          setMeetingState('error');
          setErrorDetail(
            typeof event === 'object' && event !== null
              ? JSON.stringify(event)
              : String(event)
          );
        }
      });

      if (isGuest) {
        api.on('videoConferenceJoined', () => {
          api.executeCommand('setTileView', false);
        });
        api.on('participantJoined', () => {
          api.executeCommand('setTileView', false);
        });
      }

      apiRef.current = api;
    };

    const ensureScript = () => {
      if (window.JitsiMeetExternalAPI) {
        void mount();
        return;
      }
      const existing = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[data-jitsi-external-api]')
      ).find((script) => script.src === externalApiUrl);
      if (existing) {
        existing.addEventListener('load', () => {
          if (!cancelled) void mount();
        });
        return;
      }
      const script = document.createElement('script');
      script.src = externalApiUrl;
      script.async = true;
      script.dataset.jitsiExternalApi = 'true';
      script.onload = () => {
        if (!cancelled) void mount();
      };
      script.onerror = () => {
        if (!cancelled) {
          setMeetingState('error');
          setErrorDetail(`Could not load ${externalApiUrl}`);
        }
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
  }, [applyStaffBackground, roomName, displayName, isGuest, videoIssue]);

  const showBlockingOverlay = meetingState !== 'ready' && (videoIssue || meetingState === 'error');
  const showSpinner = meetingState === 'loading' || meetingState === 'connecting';

  return (
    <div className="relative h-full w-full min-h-[200px] overflow-hidden bg-black">
      <div ref={containerRef} className="h-full w-full" />

      {!isGuest && (
        <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-md border border-white/10 bg-black/70 px-2.5 py-1 text-[10px] uppercase tracking-widest text-white/55">
          {JITSI_PROVIDER_LABEL}
        </div>
      )}

      {!isGuest && (
        <button
          type="button"
          className="absolute right-3 top-3 z-20 rounded-md border border-white/10 bg-black/70 px-2.5 py-1 text-[10px] uppercase tracking-widest text-white/75 transition hover:border-[var(--color-hotel-accent)] hover:text-white disabled:cursor-wait disabled:opacity-65"
          onClick={toggleStaffBackground}
          disabled={staffBackgroundState === 'applying'}
        >
          {staffBackgroundState === 'applying'
            ? 'Background...'
            : staffBackgroundEnabled
              ? staffBackgroundState === 'failed'
                ? 'Retry background'
                : 'Background on'
              : 'Background off'}
        </button>
      )}

      {showSpinner && !showBlockingOverlay && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 text-center">
          <div className="h-10 w-10 rounded-full border-2 border-[var(--color-hotel-accent)]/25 border-t-[var(--color-hotel-accent)] animate-spin" />
          <p className="text-sm text-white/65">
            {meetingState === 'loading' ? 'Loading video bridge...' : 'Joining concierge call...'}
          </p>
        </div>
      )}

      {showBlockingOverlay && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/90 p-6">
          <div className="w-full max-w-lg rounded-lg border border-[var(--color-hotel-border)] bg-[#15110d] p-5 shadow-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-hotel-accent)]">
              Video check
            </p>
            <h2 className="mt-3 text-xl text-white">
              {meetingState === 'error'
                ? 'The video call could not start.'
                : videoIssue?.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/65">
              {meetingState === 'error'
                ? errorDetail || 'Jitsi reported a startup error.'
                : videoIssue?.body}
            </p>
            {videoIssue && (
              <ul className="mt-4 space-y-2 text-sm text-white/75">
                {videoIssue.actions.map((action) => (
                  <li key={action} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-hotel-accent)]" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 rounded-md border border-white/10 bg-black/40 p-3 text-xs text-white/45">
              Room <span className="font-mono text-white/65">{roomName}</span>
              <span className="mx-2 text-white/25">/</span>
              Domain <span className="font-mono text-white/65">{JITSI_DOMAIN}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
