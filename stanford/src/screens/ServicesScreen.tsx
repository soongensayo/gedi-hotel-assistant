import type { ServiceOffer } from '../types';

type Props = {
  services: ServiceOffer[];
  onSelect: (s: ServiceOffer) => void;
};

export function ServicesScreen({ services, onSelect }: Props) {
  return (
    <div className="space-y-4">
      <h3 className="text-center text-xl text-[var(--color-hotel-accent)]">
        Dining & Spa
      </h3>
      <p className="text-center text-sm text-[var(--color-hotel-text-dim)]">
        Tap a service — your concierge will book it for you.
      </p>
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {services.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="w-full rounded-lg border border-[var(--color-hotel-border)] bg-white/5 p-3 text-left hover:border-[var(--color-hotel-accent)]"
              onClick={() => onSelect(s)}
            >
              <span className="text-xs uppercase text-[var(--color-hotel-accent)]">
                {s.category}
              </span>
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-[var(--color-hotel-text-dim)]">{s.description}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
