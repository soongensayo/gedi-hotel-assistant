import { useEffect, useRef, useState, useCallback } from 'react';
import AgoraRTC, {
  type IAgoraRTCClient,
  type ILocalVideoTrack,
  type ILocalAudioTrack,
  type IRemoteVideoTrack,
  type IRemoteAudioTrack,
} from 'agora-rtc-sdk-ng';
import { useCheckinStore } from '../../stores/checkinStore';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

type CallStatus =
  | 'idle'
  | 'fetching-token'
  | 'joining'
  | 'waiting-for-staff'
  | 'connected'
  | 'error'
  | 'ended';

// Set to 0 (DEBUG) temporarily to diagnose connection issues; change to 4 (NONE) once working
AgoraRTC.setLogLevel(0);

export function VideoCallScreen() {
  const resetSession = useCheckinStore((s) => s.resetSession);

  const [status, setStatus] = useState<CallStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localVideoRef = useRef<ILocalVideoTrack | null>(null);
  const localAudioRef = useRef<ILocalAudioTrack | null>(null);
  const remoteVideoRef = useRef<IRemoteVideoTrack | null>(null);
  const remoteAudioRef = useRef<IRemoteAudioTrack | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // DOM containers
  const remoteVideoContainerRef = useRef<HTMLDivElement>(null);
  const localVideoContainerRef = useRef<HTMLDivElement>(null);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const cleanupCall = useCallback(async () => {
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);

    localVideoRef.current?.stop();
    localVideoRef.current?.close();
    localAudioRef.current?.stop();
    localAudioRef.current?.close();
    remoteVideoRef.current?.stop();
    remoteAudioRef.current?.stop();

    if (clientRef.current) {
      await clientRef.current.leave().catch(() => {});
      clientRef.current.removeAllListeners();
      clientRef.current = null;
    }

    localVideoRef.current = null;
    localAudioRef.current = null;
    remoteVideoRef.current = null;
    remoteAudioRef.current = null;
  }, []);

  const startCall = useCallback(async () => {
    setStatus('fetching-token');
    setErrorMsg('');
    setCallDuration(0);

    // Fetch channel config from backend
    let channelConfig: { token: string | null; appId: string; channel: string; uid: number };
    try {
      const res = await fetch(`${BACKEND_URL}/api/videocall/token`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      channelConfig = await res.json();
    } catch (err) {
      console.error('[VideoCall] Token fetch failed:', err);
      setStatus('error');
      setErrorMsg('Could not reach the front desk server. Make sure the backend is running and try again.');
      return;
    }

    // Diagnostic log — check browser console for these values
    console.log('[VideoCall] Channel config received:', {
      appId: channelConfig.appId,
      appIdLength: channelConfig.appId?.length,
      channel: channelConfig.channel,
      uid: channelConfig.uid,
      tokenPresent: !!channelConfig.token,
      tokenPrefix: channelConfig.token?.substring(0, 6) ?? 'null',
      tokenLength: channelConfig.token?.length ?? 0,
    });

    setStatus('joining');

    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    clientRef.current = client;

    // Remote user published (staff joined)
    client.on('user-published', async (user, mediaType) => {
      await client.subscribe(user, mediaType);

      if (mediaType === 'video') {
        remoteVideoRef.current = user.videoTrack ?? null;
        if (user.videoTrack && remoteVideoContainerRef.current) {
          user.videoTrack.play(remoteVideoContainerRef.current);
        }
        setStatus('connected');
        durationTimerRef.current = setInterval(() => {
          setCallDuration((d) => d + 1);
        }, 1000);
      }

      if (mediaType === 'audio') {
        remoteAudioRef.current = user.audioTrack ?? null;
        user.audioTrack?.play();
      }
    });

    client.on('user-unpublished', (_user, mediaType) => {
      if (mediaType === 'video') {
        remoteVideoRef.current?.stop();
        remoteVideoRef.current = null;
      }
    });

    client.on('user-left', () => {
      setStatus('ended');
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    });

    // Step 1: Join channel
    try {
      await client.join(
        channelConfig.appId,
        channelConfig.channel,
        channelConfig.token,  // null = test mode (no token auth required)
        channelConfig.uid,
      );
    } catch (err: unknown) {
      console.error('[VideoCall] Channel join failed — full error:', JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
      await cleanupCall();
      setStatus('error');
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED' || code === 'DYNAMIC_KEY_EXPIRED') {
        setErrorMsg('Authentication error: the call token was rejected. Please check your Agora App ID and certificate configuration.');
      } else {
        setErrorMsg(`Could not join the call channel (${code || 'unknown error'}). Check that the backend is running and your Agora project is active.`);
      }
      return;
    }

    // Step 2: Request camera & microphone
    let audioTrack: ILocalAudioTrack;
    let videoTrack: ILocalVideoTrack;
    try {
      [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
    } catch (err: unknown) {
      console.error('[VideoCall] Camera/mic failed:', err);
      await cleanupCall();
      setStatus('error');
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setErrorMsg('Camera or microphone access was denied. Please allow permissions in your browser and try again.');
      } else if (name === 'NotFoundError') {
        setErrorMsg('No camera or microphone found on this device.');
      } else {
        setErrorMsg('Could not start your camera or microphone. Please check your device and permissions.');
      }
      return;
    }

    localAudioRef.current = audioTrack;
    localVideoRef.current = videoTrack;

    if (localVideoContainerRef.current) {
      videoTrack.play(localVideoContainerRef.current);
    }

    try {
      await client.publish([audioTrack, videoTrack]);
    } catch (err) {
      console.error('[VideoCall] Publish failed:', err);
      // Non-fatal — still show the waiting screen
    }

    setStatus('waiting-for-staff');
  }, [cleanupCall]);

  const endCall = useCallback(async () => {
    await cleanupCall();
    resetSession();
  }, [cleanupCall, resetSession]);

  const toggleMute = useCallback(() => {
    if (!localAudioRef.current) return;
    const next = !isMuted;
    localAudioRef.current.setEnabled(!next);
    setIsMuted(next);
  }, [isMuted]);

  const toggleCamera = useCallback(() => {
    if (!localVideoRef.current) return;
    const next = !isCamOff;
    localVideoRef.current.setEnabled(!next);
    setIsCamOff(next);
  }, [isCamOff]);

  // Auto-start on mount
  useEffect(() => {
    startCall();
    return () => {
      cleanupCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full w-full flex flex-col bg-hotel-dark relative overflow-hidden">

      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-hotel-accent/20 to-hotel-accent-2/20 border border-hotel-accent/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-hotel-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <p className="text-hotel-text text-sm font-medium tracking-wide">The Grand Azure</p>
            <p className="text-hotel-text-dim text-xs tracking-widest uppercase">Front Desk</p>
          </div>
        </div>

        {/* Status pill */}
        <StatusPill status={status} duration={callDuration} formatDuration={formatDuration} />
      </div>

      {/* ── Video area ─────────────────────────────────── */}
      <div className="flex-1 relative">

        {/* Remote video (full area) */}
        <div
          ref={remoteVideoContainerRef}
          className="absolute inset-0 bg-hotel-dark-mid"
        />

        {/* Idle / connecting overlay */}
        {status !== 'connected' && status !== 'ended' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 z-10">
            <div className="w-24 h-24 rounded-full bg-hotel-accent/10 border border-hotel-accent/20 flex items-center justify-center">
              <svg className="w-12 h-12 text-hotel-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-hotel-text text-xl font-light tracking-wide">
                {status === 'error' ? 'Connection Failed' : 'Hotel Front Desk'}
              </p>
              <p className="text-hotel-text-dim text-sm mt-1">
                {statusLabel(status)}
              </p>
              {status === 'error' && errorMsg && (
                <p className="text-red-400/80 text-xs mt-3 max-w-xs leading-relaxed">{errorMsg}</p>
              )}
            </div>

            {/* Pulse rings for connecting/waiting states */}
            {(status === 'fetching-token' || status === 'joining' || status === 'waiting-for-staff') && (
              <PulseRings />
            )}

            {/* Retry on error */}
            {status === 'error' && (
              <button
                onClick={startCall}
                className="mt-2 px-6 py-2.5 rounded-xl border border-hotel-accent/30 text-hotel-accent text-sm tracking-wide hover:bg-hotel-accent/10 transition-colors duration-300"
              >
                Try Again
              </button>
            )}
          </div>
        )}

        {/* Call-ended overlay */}
        {status === 'ended' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 z-10 bg-hotel-dark/80 backdrop-blur-sm">
            <div className="w-16 h-16 rounded-full bg-hotel-accent/10 border border-hotel-accent/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-hotel-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-hotel-text text-xl font-light">Call Ended</p>
              <p className="text-hotel-text-dim text-sm mt-1">
                Duration: {formatDuration(callDuration)}
              </p>
            </div>
            <button
              onClick={endCall}
              className="px-8 py-3 rounded-2xl bg-hotel-accent/10 border border-hotel-accent/25 text-hotel-accent text-sm font-medium tracking-wide hover:bg-hotel-accent/18 transition-all duration-300"
            >
              Return to Welcome
            </button>
          </div>
        )}

        {/* Local video PiP */}
        {(status === 'waiting-for-staff' || status === 'connected') && (
          <div
            ref={localVideoContainerRef}
            className={`absolute bottom-4 right-4 w-32 h-24 rounded-xl overflow-hidden border border-white/10 shadow-xl z-20 transition-opacity duration-300 ${isCamOff ? 'opacity-40' : 'opacity-100'}`}
          />
        )}
      </div>

      {/* ── Controls ───────────────────────────────────── */}
      {(status === 'waiting-for-staff' || status === 'connected') && (
        <div className="flex items-center justify-center gap-4 px-6 py-5 border-t border-white/5 z-10">

          {/* Mute */}
          <ControlButton
            active={isMuted}
            onClick={toggleMute}
            label={isMuted ? 'Unmute' : 'Mute'}
            activeIcon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            }
            inactiveIcon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072M19.07 4.93a10 10 0 010 14.14" />
              </svg>
            }
          />

          {/* Camera */}
          <ControlButton
            active={isCamOff}
            onClick={toggleCamera}
            label={isCamOff ? 'Show camera' : 'Hide camera'}
            activeIcon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3l18 18" />
              </svg>
            }
            inactiveIcon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            }
          />

          {/* End call */}
          <button
            onClick={endCall}
            className="flex flex-col items-center gap-1.5 group"
          >
            <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center transition-all duration-300 group-hover:bg-red-500/25 group-hover:border-red-500/50 group-active:scale-95">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
              </svg>
            </div>
            <span className="text-red-400/70 text-xs tracking-wide">End Call</span>
          </button>

        </div>
      )}

      {/* End call button visible in error state too */}
      {status === 'error' && (
        <div className="flex justify-center pb-6 z-10">
          <button
            onClick={endCall}
            className="px-8 py-3 rounded-2xl border border-white/10 text-hotel-text-dim text-sm tracking-wide hover:border-white/20 hover:text-hotel-text transition-colors duration-300"
          >
            Back to Welcome
          </button>
        </div>
      )}

    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function statusLabel(status: CallStatus): string {
  switch (status) {
    case 'fetching-token': return 'Contacting front desk…';
    case 'joining': return 'Connecting to video…';
    case 'waiting-for-staff': return 'Waiting for staff to join…';
    case 'connected': return 'Connected';
    case 'ended': return 'Call ended';
    case 'error': return 'Unable to connect';
    default: return '';
  }
}

function StatusPill({ status, duration, formatDuration }: {
  status: CallStatus;
  duration: number;
  formatDuration: (s: number) => string;
}) {
  if (status === 'connected') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-emerald-400 text-xs font-medium tabular-nums">{formatDuration(duration)}</span>
      </div>
    );
  }
  if (status === 'waiting-for-staff' || status === 'joining' || status === 'fetching-token') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-hotel-accent/10 border border-hotel-accent/15">
        <span className="w-2 h-2 rounded-full bg-hotel-accent animate-pulse" />
        <span className="text-hotel-accent text-xs tracking-wide">Connecting</span>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        <span className="text-red-400 text-xs tracking-wide">Error</span>
      </div>
    );
  }
  return null;
}

function PulseRings() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className="absolute rounded-full border border-hotel-accent/20"
          style={{
            width: `${140 + i * 60}px`,
            height: `${140 + i * 60}px`,
            animation: `ping ${1.2 + i * 0.3}s cubic-bezier(0,0,0.2,1) infinite`,
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}

function ControlButton({
  active,
  onClick,
  label,
  activeIcon,
  inactiveIcon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  activeIcon: React.ReactNode;
  inactiveIcon: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 group">
      <div
        className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all duration-300 group-active:scale-95 ${
          active
            ? 'bg-white/10 border-white/20 text-white'
            : 'bg-white/5 border-white/10 text-hotel-text-dim group-hover:bg-white/8 group-hover:border-white/15 group-hover:text-hotel-text'
        }`}
      >
        {active ? activeIcon : inactiveIcon}
      </div>
      <span className="text-hotel-text-dim/60 text-xs tracking-wide">{label}</span>
    </button>
  );
}
