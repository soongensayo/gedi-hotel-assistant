import { useState } from 'react';

type Props = {
  onCallConcierge: () => void;
};

/** Replace with your showcase video ID via VITE_STANFORD_YOUTUBE_EMBED */
const DEMO_VIDEO =
  (import.meta.env.VITE_STANFORD_YOUTUBE_EMBED as string | undefined) ??
  'https://www.youtube.com/embed/jfKfPfyJRdk';

export function MediaScreen({ onCallConcierge }: Props) {
  const [tab, setTab] = useState<'music' | 'video'>('video');

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 justify-center gap-2 border-b border-[var(--color-hotel-border)] p-3">
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm ${
            tab === 'music' ? 'bg-[var(--color-hotel-accent)] text-black' : 'text-white/70'
          }`}
          onClick={() => setTab('music')}
        >
          Music
        </button>
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm ${
            tab === 'video' ? 'bg-[var(--color-hotel-accent)] text-black' : 'text-white/70'
          }`}
          onClick={() => setTab('video')}
        >
          Video
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {tab === 'music' && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-[var(--color-hotel-text-dim)]">Now playing (demo)</p>
            <p className="mt-2 text-xl text-[var(--color-hotel-accent)]">Jazz Essentials</p>
            <p className="mt-4 text-sm text-white/50">
              Wire your audio source or streaming API for the showcase.
            </p>
          </div>
        )}
        {tab === 'video' && (
          <div className="flex h-full flex-col">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--color-hotel-border)]">
              <iframe
                title="YouTube"
                className="h-full w-full"
                src={DEMO_VIDEO}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 p-6">
        <button
          type="button"
          className="w-full rounded-full border border-[var(--color-hotel-accent)] bg-[var(--color-hotel-accent)]/20 py-4 text-[var(--color-hotel-accent)] shadow-[0_0_20px_rgba(197,160,89,0.35)] animate-pulse"
          onClick={onCallConcierge}
        >
          Call Concierge
        </button>
      </div>
    </div>
  );
}
