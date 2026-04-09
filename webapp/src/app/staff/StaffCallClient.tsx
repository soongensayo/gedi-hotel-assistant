'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// Agora is browser-only — dynamic import avoids SSR issues
import type AgoraRTCType from 'agora-rtc-sdk-ng';
import type {
  IAgoraRTCClient,
  ILocalVideoTrack,
  ILocalAudioTrack,
  IRemoteVideoTrack,
  IRemoteAudioTrack,
} from 'agora-rtc-sdk-ng';

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || '43290892f6d14bebbccd6f05b2bdf9b9';
const DEFAULT_CHANNEL = process.env.NEXT_PUBLIC_AGORA_CHANNEL || 'frontdesk';
const DEFAULT_TOKEN = process.env.NEXT_PUBLIC_AGORA_TOKEN || '';

type CallStatus = 'idle' | 'joining' | 'waiting' | 'connected' | 'ended' | 'error';

export default function StaffCallClient() {
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [status, setStatus] = useState<CallStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [guestConnected, setGuestConnected] = useState(false);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localVideoRef = useRef<ILocalVideoTrack | null>(null);
  const localAudioRef = useRef<ILocalAudioTrack | null>(null);
  const remoteVideoRef = useRef<IRemoteVideoTrack | null>(null);
  const remoteAudioRef = useRef<IRemoteAudioTrack | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteContainerRef = useRef<HTMLDivElement>(null);
  const localContainerRef = useRef<HTMLDivElement>(null);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const cleanup = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    localVideoRef.current?.stop(); localVideoRef.current?.close();
    localAudioRef.current?.stop(); localAudioRef.current?.close();
    remoteVideoRef.current?.stop(); remoteAudioRef.current?.stop();
    if (clientRef.current) {
      await clientRef.current.leave().catch(() => {});
      clientRef.current.removeAllListeners();
      clientRef.current = null;
    }
    localVideoRef.current = null; localAudioRef.current = null;
    remoteVideoRef.current = null; remoteAudioRef.current = null;
  }, []);

  const joinCall = useCallback(async () => {
    if (!token.trim()) {
      setErrorMsg('Please enter the Agora token first.');
      return;
    }
    setStatus('joining');
    setErrorMsg('');
    setCallDuration(0);
    setGuestConnected(false);

    const AgoraRTC: typeof AgoraRTCType = (await import('agora-rtc-sdk-ng')).default;
    AgoraRTC.setLogLevel(3);

    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    clientRef.current = client;

    client.on('user-published', async (user, mediaType) => {
      await client.subscribe(user, mediaType);
      if (mediaType === 'video') {
        remoteVideoRef.current = user.videoTrack ?? null;
        if (user.videoTrack && remoteContainerRef.current) {
          user.videoTrack.play(remoteContainerRef.current);
        }
        setGuestConnected(true);
        setStatus('connected');
        timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
      }
      if (mediaType === 'audio') {
        remoteAudioRef.current = user.audioTrack ?? null;
        user.audioTrack?.play();
      }
    });

    client.on('user-unpublished', (_u, mediaType) => {
      if (mediaType === 'video') { remoteVideoRef.current?.stop(); remoteVideoRef.current = null; }
    });
    client.on('user-left', () => {
      setGuestConnected(false);
      setStatus('waiting');
      if (timerRef.current) clearInterval(timerRef.current);
    });

    // Step 1: join channel
    try {
      await client.join(APP_ID, DEFAULT_CHANNEL, token.trim(), 0);
    } catch (err: unknown) {
      console.error('[StaffPortal] Join failed:', err);
      await cleanup();
      setStatus('error');
      const msg = (err as { message?: string })?.message ?? '';
      setErrorMsg(`Could not join channel: ${msg || 'check your token and App ID'}`);
      return;
    }

    // Step 2: camera & mic
    try {
      const [audio, video] = await AgoraRTC.createMicrophoneAndCameraTracks({
        AEC: true,
        AGC: true,
        ANS: true,
      });
      localAudioRef.current = audio;
      localVideoRef.current = video;
      if (localContainerRef.current) video.play(localContainerRef.current);
      await client.publish([audio, video]);
      setStatus('waiting');
    } catch (err: unknown) {
      console.error('[StaffPortal] Camera/mic failed:', err);
      await cleanup();
      setStatus('error');
      setErrorMsg('Camera or microphone permission denied. Please allow access and try again.');
    }
  }, [token, cleanup]);

  const endCall = useCallback(async () => {
    await cleanup();
    setStatus('ended');
    setGuestConnected(false);
  }, [cleanup]);

  const toggleMute = () => {
    if (!localAudioRef.current) return;
    const next = !isMuted;
    localAudioRef.current.setEnabled(!next);
    setIsMuted(next);
  };

  const toggleCam = () => {
    if (!localVideoRef.current) return;
    const next = !isCamOff;
    localVideoRef.current.setEnabled(!next);
    setIsCamOff(next);
  };

  useEffect(() => () => { cleanup(); }, [cleanup]);

  const isInCall = status === 'waiting' || status === 'connected';

  return (
    <div className="min-h-screen bg-charcoal flex flex-col">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gold/15 border border-gold/25 flex items-center justify-center">
            <svg className="w-4 h-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <p className="text-white/90 text-sm font-medium tracking-wide">The Grand Azure</p>
            <p className="text-white/40 text-xs tracking-widest uppercase">Staff Portal</p>
          </div>
        </div>

        {/* Status badge */}
        {status === 'connected' && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-400 text-xs font-medium tabular-nums">{fmt(callDuration)}</span>
          </div>
        )}
        {isInCall && status !== 'connected' && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold/10 border border-gold/20">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            <span className="text-gold text-xs tracking-wide">Waiting for guest…</span>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6">

        {/* ── Idle / setup ── */}
        {(status === 'idle' || status === 'ended' || status === 'error') && (
          <div className="w-full max-w-md flex flex-col gap-5">
            <div className="text-center">
              <h1 className="text-white/90 text-2xl font-light tracking-wide">Front Desk Video Call</h1>
              <p className="text-white/40 text-sm mt-1">
                {status === 'ended'
                  ? 'Call ended. Start a new session when ready.'
                  : 'Paste the Agora token and join to receive guest calls.'}
              </p>
            </div>

            {status === 'error' && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm leading-relaxed">
                {errorMsg}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-white/50 text-xs tracking-widest uppercase">Agora Token</label>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="007eJxT… (paste from Agora console or your .env)"
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white/80 text-sm placeholder-white/20 resize-none focus:outline-none focus:border-gold/40 transition-colors"
              />
              <p className="text-white/25 text-xs">
                Channel: <span className="text-white/40 font-mono">{DEFAULT_CHANNEL}</span> · App ID: <span className="text-white/40 font-mono">{APP_ID.slice(0, 8)}…</span>
              </p>
            </div>

            <button
              onClick={joinCall}
              disabled={!token.trim()}
              className="flex items-center justify-center gap-2.5 w-full py-4 rounded-2xl bg-gold/10 border border-gold/25 text-gold font-medium tracking-wide transition-all duration-300 hover:bg-gold/18 hover:border-gold/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
              Join as Hotel Staff
            </button>
          </div>
        )}

        {/* ── Joining spinner ── */}
        {status === 'joining' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
            <p className="text-white/60 text-sm">Connecting to channel…</p>
          </div>
        )}

        {/* ── In call ── */}
        {isInCall && (
          <div className="w-full max-w-2xl flex flex-col gap-4">

            {/* Video area */}
            <div className="relative w-full aspect-video bg-white/3 rounded-2xl overflow-hidden border border-white/8">

              {/* Remote (guest) video */}
              <div ref={remoteContainerRef} className="absolute inset-0" />

              {/* Placeholder when no guest yet */}
              {!guestConnected && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-gold/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <p className="text-white/40 text-sm">Waiting for guest to connect…</p>
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-gold/40 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Local (staff) PiP */}
              <div
                ref={localContainerRef}
                className={`absolute bottom-3 right-3 w-28 h-20 rounded-lg overflow-hidden border border-white/15 shadow-lg transition-opacity ${isCamOff ? 'opacity-30' : 'opacity-100'}`}
              />
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-4">
              {/* Mute */}
              <CallButton active={isMuted} onClick={toggleMute} label={isMuted ? 'Unmute' : 'Mute'}>
                {isMuted ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </CallButton>

              {/* Camera */}
              <CallButton active={isCamOff} onClick={toggleCam} label={isCamOff ? 'Show cam' : 'Hide cam'}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                  {isCamOff && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3l18 18" />}
                </svg>
              </CallButton>

              {/* End call */}
              <button onClick={endCall} className="flex flex-col items-center gap-1.5 group">
                <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center transition-all duration-300 group-hover:bg-red-500/25 group-active:scale-95">
                  <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                  </svg>
                </div>
                <span className="text-red-400/70 text-xs">End Call</span>
              </button>
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="px-6 py-3 border-t border-white/5 text-center">
        <p className="text-white/20 text-xs tracking-wide">The Grand Azure · Internal Staff Portal</p>
      </footer>

    </div>
  );
}

function CallButton({
  active, onClick, label, children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 group">
      <div className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all duration-300 group-active:scale-95 ${
        active ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-white/50 group-hover:bg-white/8 group-hover:text-white/70'
      }`}>
        {children}
      </div>
      <span className="text-white/30 text-xs">{label}</span>
    </button>
  );
}
