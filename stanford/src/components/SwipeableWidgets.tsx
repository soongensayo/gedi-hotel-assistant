import { useCallback, useEffect, useRef, useState } from 'react';

type Widget = 'clock' | 'maps' | 'weather' | 'news';

const WIDGETS: Widget[] = ['clock', 'maps', 'weather', 'news'];

export function SwipeableWidgets() {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const go = useCallback((dir: -1 | 1) => {
    setIndex((i) => {
      const n = i + dir;
      if (n < 0) return WIDGETS.length - 1;
      if (n >= WIDGETS.length) return 0;
      return n;
    });
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (dx > 50) go(-1);
    else if (dx < -50) go(1);
  };

  const w = WIDGETS[index];

  return (
    <div
      className="relative mx-auto w-full max-w-xl rounded-lg border border-[var(--color-hotel-border)] bg-[var(--guest-card-strong)] px-4 py-5 shadow-[0_18px_48px_rgba(31,106,88,0.12)]"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="mb-3 flex justify-center gap-2">
        {WIDGETS.map((_, i) => (
          <button
            key={WIDGETS[i]}
            type="button"
            aria-label={`Show widget ${i + 1}`}
            className={`h-2 w-2 rounded-full transition-colors ${
              i === index ? 'bg-[var(--color-hotel-accent)]' : 'bg-[var(--color-hotel-border)]'
            }`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>

      {w === 'clock' && <ClockWidget />}
      {w === 'maps' && <MapsWidget />}
      {w === 'weather' && <WeatherWidget />}
      {w === 'news' && <NewsWidget />}
    </div>
  );
}

function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-center">
      <p className="text-sm tracking-widest text-[var(--color-hotel-text-dim)]">
        Singapore
      </p>
      <p className="mt-2 font-mono text-4xl text-[var(--color-hotel-accent)]">
        {now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="mt-1 text-[var(--color-hotel-text-dim)]">
        {now.toLocaleDateString('en-SG', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </p>
    </div>
  );
}

function MapsWidget() {
  return (
    <div className="h-48 overflow-hidden rounded-lg border border-white/10">
      <iframe
        title="Singapore map"
        className="h-full w-full border-0 grayscale contrast-125"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src="https://www.openstreetmap.org/export/embed.html?bbox=103.75%2C1.22%2C104.05%2C1.48&layer=mapnik"
      />
    </div>
  );
}

function WeatherWidget() {
  return (
    <div className="text-center">
      <p className="text-5xl text-[var(--color-hotel-accent)]">31°C</p>
      <p className="mt-2 text-[var(--color-hotel-text-dim)]">Partly cloudy · Humid</p>
      <p className="mt-4 text-sm text-[var(--color-hotel-text-dim)]">
        Showcase preview — connect a weather API later for live data.
      </p>
    </div>
  );
}

function NewsWidget() {
  return (
    <ul className="space-y-3 text-left text-sm text-[var(--color-hotel-text)]">
      <li className="border-b border-[var(--color-hotel-border)] pb-2">
        <span className="text-[var(--color-hotel-accent)]">Local</span> — Marina Bay
        evening light show returns this week.
      </li>
      <li className="border-b border-[var(--color-hotel-border)] pb-2">
        <span className="text-[var(--color-hotel-accent)]">Travel</span> — Changi named
        best airport hub in Asia-Pacific.
      </li>
      <li>
        <span className="text-[var(--color-hotel-accent)]">Hotel</span> — LuxeDrive
        partners announce in-car concierge pilot.
      </li>
    </ul>
  );
}
