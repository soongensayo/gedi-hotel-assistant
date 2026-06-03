import { useEffect, useMemo, useState } from 'react';

const EXPERIENCES = [
  {
    label: 'Featured invitation',
    title: 'Lantern Lounge aperitif',
    body: 'Complimentary first pour from 18:00 to 19:00 for arriving guests. Low music, skyline seats, and a short walk from the lift lobby.',
    meta: 'Tonight only',
    imageSrc: '/images/first-pour.png',
  },
  {
    label: 'Private dining',
    title: 'Chef counter encore',
    body: 'A limited tasting menu opens after check-in, with a late seating held for arriving suite guests.',
    meta: '19:30 seating',
    imageSrc: '/images/chef-encore.png',
  },
  {
    label: 'Wellness ritual',
    title: 'Steam, tea, stillness',
    body: 'The recovery suite pairs a eucalyptus steam room with a calming tea service before turndown.',
    meta: 'Level 6',
    imageSrc: '/images/steam-room.png',
  },
];

const FACTS = [
  ['1928', 'Original riverside facade restored'],
  ['Level 38', 'Rooftop pool and evening lounge'],
  ['24 hr', 'Concierge, luggage, and dining support'],
];

export function GuestShowcasePanel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeExperience = EXPERIENCES[activeIndex];
  const tickerItems = useMemo(
    () => [...FACTS, ...FACTS].map(([value, label]) => `${value} / ${label}`),
    []
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % EXPERIENCES.length);
    }, 5800);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="guest-showcase-panel relative shrink-0 overflow-hidden border-t border-[var(--color-hotel-border)] bg-[#eee5d5]">
      <img
        src="/images/luxury-arrival-showcase.png"
        alt=""
        className="hotel-ambient-image absolute inset-0 h-full w-full scale-105 object-cover opacity-28 mix-blend-multiply"
      />
      <div className="hotel-light-sweep absolute inset-y-0 left-[-35%] w-1/2 rotate-12 bg-[linear-gradient(90deg,transparent,rgba(255,252,244,0.46),transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(244,239,228,0.96),rgba(244,239,228,0.76)_48%,rgba(237,226,207,0.92))]" />
      <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(244,239,228,0.96),rgba(244,239,228,0.54)_58%,rgba(244,239,228,0.9))]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_30%,rgba(31,106,88,0.12),transparent_28%),radial-gradient(circle_at_78%_58%,rgba(181,138,74,0.14),transparent_30%)]" />

      <div className="guest-showcase-content relative grid h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-3 px-5 py-4 md:px-10 md:py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-[var(--color-hotel-accent)]">
              Tonight at the house
            </p>
            <h2 className="mt-1 text-2xl leading-tight text-[var(--color-hotel-text)] md:text-3xl">
              A quieter arrival, a better evening.
            </h2>
          </div>
          <p className="hidden max-w-xs text-right text-xs leading-5 text-[var(--color-hotel-text-dim)] sm:block">
            Ask your concierge to add any experience to your stay before your key is issued.
          </p>
        </div>

        <div className="guest-showcase-main grid min-h-0">
          <article className="guest-feature-card relative flex min-h-0 flex-col justify-between overflow-hidden rounded-lg border border-[var(--color-hotel-border)] bg-[var(--guest-card-strong)] p-5 shadow-[0_18px_60px_rgba(31,106,88,0.12)] backdrop-blur-sm">
            <img
              key={activeExperience.imageSrc}
              src={activeExperience.imageSrc}
              alt=""
              className="guest-offering-image absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,252,244,0.92),rgba(255,252,244,0.72)_34%,rgba(255,252,244,0.18)_58%,rgba(255,252,244,0)_78%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(255,252,244,0.18),transparent_36%,rgba(255,252,244,0.04))]" />
            <div className="absolute left-0 top-0 h-px w-full bg-[linear-gradient(90deg,transparent,var(--color-hotel-accent),transparent)] opacity-60" />
            <div
              key={activeExperience.title}
              className="hotel-card-reveal relative max-w-[45%]"
            >
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[11px] uppercase tracking-widest text-[var(--color-hotel-text-dim)]">
                  {activeExperience.label}
                </p>
                <span className="rounded-full border border-[var(--color-hotel-accent)]/35 bg-[var(--color-hotel-accent)]/10 px-2 py-1 text-[10px] uppercase tracking-widest text-[var(--color-hotel-accent)]">
                  {activeExperience.meta}
                </span>
              </div>
              <h3 className="mt-2 text-xl text-[var(--color-hotel-accent)]">
                {activeExperience.title}
              </h3>
              <p className="guest-feature-body mt-2 max-w-2xl text-[15px] leading-6 text-[var(--color-hotel-text-dim)]">
                {activeExperience.body}
              </p>
            </div>
            <div className="relative mt-4 flex items-center gap-2">
              {EXPERIENCES.map((item, index) => (
                <button
                  key={item.title}
                  type="button"
                  aria-label={`Show ${item.title}`}
                  className={`h-1.5 rounded-full transition-all ${
                    index === activeIndex
                      ? 'w-9 bg-[var(--color-hotel-accent)]'
                      : 'w-3 bg-[var(--color-hotel-border)]'
                  }`}
                  onClick={() => setActiveIndex(index)}
                />
              ))}
              <div className="ml-2 h-px flex-1 overflow-hidden bg-[var(--color-hotel-border)]">
                <div
                  key={activeExperience.title}
                  className="hotel-progress h-full bg-[var(--color-hotel-accent)]"
                />
              </div>
            </div>
          </article>
        </div>

        <div className="overflow-hidden border-t border-[var(--color-hotel-border)] pt-3">
          <div className="hotel-fact-ticker flex w-max gap-8">
            {tickerItems.map((item, index) => {
              const [value, label] = item.split(' / ');

              return (
                <div key={`${item}-${index}`} className="flex min-w-max items-baseline gap-2">
                  <p className="text-sm text-[var(--color-hotel-accent)]">{value}</p>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--color-hotel-text-dim)]">
                    {label}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
