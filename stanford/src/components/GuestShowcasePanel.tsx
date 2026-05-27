import { useEffect, useMemo, useState } from 'react';

const EXPERIENCES = [
  {
    label: 'Featured invitation',
    title: 'Lantern Lounge aperitif',
    body: 'Complimentary first pour from 18:00 to 19:00 for arriving guests. Low music, skyline seats, and a short walk from the lift lobby.',
    meta: 'Tonight only',
  },
  {
    label: 'Private dining',
    title: 'Chef counter encore',
    body: 'A limited tasting menu opens after check-in, with a late seating held for arriving suite guests.',
    meta: '19:30 seating',
  },
  {
    label: 'Wellness ritual',
    title: 'Steam, tea, stillness',
    body: 'The recovery suite pairs a eucalyptus steam room with a calming tea service before turndown.',
    meta: 'Level 6',
  },
];

const HIGHLIGHTS = [
  {
    label: 'Sky Pool',
    title: 'Golden hour cabanas',
    body: 'Reserve a private bay for sunset views over Marina Bay.',
  },
  {
    label: 'Dining',
    title: 'Chef counter tonight',
    body: 'A six-course tasting menu is available from 19:30.',
  },
  {
    label: 'Wellness',
    title: 'Quiet recovery suite',
    body: 'Steam, tea service, and a 60-minute signature massage.',
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
    <section className="relative h-[36vh] min-h-[300px] shrink-0 overflow-hidden border-t border-[var(--color-hotel-border)] bg-[#090706]">
      <img
        src="/images/luxury-arrival-showcase.png"
        alt=""
        className="hotel-ambient-image absolute inset-0 h-full w-full scale-105 object-cover opacity-60"
      />
      <div className="hotel-light-sweep absolute inset-y-0 left-[-35%] w-1/2 rotate-12 bg-[linear-gradient(90deg,transparent,rgba(212,176,122,0.12),transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,10,9,0.92),rgba(12,10,9,0.58)_48%,rgba(12,10,9,0.86))]" />
      <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(12,10,9,0.9),rgba(12,10,9,0.2)_58%,rgba(12,10,9,0.78))]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_30%,rgba(197,160,89,0.16),transparent_28%),radial-gradient(circle_at_78%_58%,rgba(255,255,255,0.08),transparent_30%)]" />

      <div className="relative grid h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-3 px-5 py-4 md:px-10 md:py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-hotel-accent)]">
              Tonight at the house
            </p>
            <h2 className="mt-1 text-2xl leading-tight text-[var(--color-hotel-text)] md:text-3xl">
              A quieter arrival, a better evening.
            </h2>
          </div>
          <p className="hidden max-w-xs text-right text-xs leading-5 text-white/58 sm:block">
            Ask your concierge to add any experience to your stay before your key is issued.
          </p>
        </div>

        <div className="grid min-h-0 gap-3 md:grid-cols-[1.05fr_1fr]">
          <article className="relative flex min-h-0 flex-col justify-end overflow-hidden rounded-lg border border-white/12 bg-black/30 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-sm">
            <div className="absolute left-0 top-0 h-px w-full bg-[linear-gradient(90deg,transparent,var(--color-hotel-accent),transparent)] opacity-60" />
            <div
              key={activeExperience.title}
              className="hotel-card-reveal"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-widest text-white/45">
                  {activeExperience.label}
                </p>
                <span className="rounded-full border border-[var(--color-hotel-accent)]/35 bg-[var(--color-hotel-accent)]/10 px-2 py-1 text-[9px] uppercase tracking-widest text-[var(--color-hotel-accent)]">
                  {activeExperience.meta}
                </span>
              </div>
              <h3 className="mt-2 text-xl text-[var(--color-hotel-accent)]">
                {activeExperience.title}
              </h3>
              <p className="mt-2 max-w-lg text-sm leading-6 text-white/72">
                {activeExperience.body}
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2">
              {EXPERIENCES.map((item, index) => (
                <button
                  key={item.title}
                  type="button"
                  aria-label={`Show ${item.title}`}
                  className={`h-1.5 rounded-full transition-all ${
                    index === activeIndex
                      ? 'w-9 bg-[var(--color-hotel-accent)]'
                      : 'w-3 bg-white/22'
                  }`}
                  onClick={() => setActiveIndex(index)}
                />
              ))}
              <div className="ml-2 h-px flex-1 overflow-hidden bg-white/12">
                <div
                  key={activeExperience.title}
                  className="hotel-progress h-full bg-[var(--color-hotel-accent)]"
                />
              </div>
            </div>
          </article>

          <div className="grid min-h-0 grid-cols-3 gap-2">
            {HIGHLIGHTS.map((item, index) => (
              <article
                key={item.label}
                className="hotel-float-card overflow-hidden rounded-lg border border-white/12 bg-white/[0.055] p-3 backdrop-blur-sm"
                style={{ animationDelay: `${index * 420}ms` }}
              >
                <p className="text-[9px] uppercase tracking-widest text-[var(--color-hotel-accent)]">
                  {item.label}
                </p>
                <h3 className="mt-2 text-sm leading-snug text-white">{item.title}</h3>
                <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-white/58">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </div>

        <div className="overflow-hidden border-t border-white/10 pt-3">
          <div className="hotel-fact-ticker flex w-max gap-8">
            {tickerItems.map((item, index) => {
              const [value, label] = item.split(' / ');

              return (
                <div key={`${item}-${index}`} className="flex min-w-max items-baseline gap-2">
                  <p className="text-sm text-[var(--color-hotel-accent)]">{value}</p>
                  <p className="text-[10px] uppercase tracking-widest text-white/42">
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
