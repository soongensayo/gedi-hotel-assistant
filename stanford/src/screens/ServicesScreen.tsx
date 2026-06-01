import type { ServiceOffer } from '../types';

type Props = {
  services: ServiceOffer[];
  onSelect: (s: ServiceOffer) => void;
};

export function ServicesScreen({ services, onSelect }: Props) {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <h3 className="text-center text-lg text-[var(--color-hotel-accent)]">
        Dining & Spa
      </h3>
      <p className="text-center text-xs leading-5 text-[var(--color-hotel-text-dim)]">
        Tap a service — your concierge will book it for you.
      </p>
      <ul className="grid grid-cols-2 gap-2">
        {services.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="h-full w-full rounded-lg border border-[var(--color-hotel-border)] bg-white/5 p-2.5 text-left hover:border-[var(--color-hotel-accent)]"
              onClick={() => onSelect(s)}
            >
              <span className="text-[10px] uppercase text-[var(--color-hotel-accent)]">
                {s.category}
              </span>
              <p className="text-sm font-medium leading-tight">{s.name}</p>
              <p className="text-xs text-[var(--color-hotel-text-dim)]">{s.description}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
