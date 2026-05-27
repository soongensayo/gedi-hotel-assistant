import { useState } from 'react';

type Props = {
  onSubmit: (count: number, needsHelp: boolean, etaNote: string) => void;
};

export function LuggageScreen({ onSubmit }: Props) {
  const [count, setCount] = useState(1);
  const [needsHelp, setNeedsHelp] = useState(false);
  const [eta, setEta] = useState('');

  return (
    <div className="space-y-4">
      <h3 className="text-center text-xl text-[var(--color-hotel-accent)]">Luggage</h3>
      <label className="block text-sm">
        <span className="text-[var(--color-hotel-text-dim)]">Number of bags</span>
        <input
          type="number"
          min={0}
          max={20}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="mt-2 w-full rounded-lg border border-[var(--color-hotel-border)] bg-black/40 p-2 text-white"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={needsHelp}
          onChange={(e) => setNeedsHelp(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-hotel-accent)]"
        />
        <span>We need help with luggage on arrival</span>
      </label>
      <label className="block text-sm">
        <span className="text-[var(--color-hotel-text-dim)]">ETA note (optional)</span>
        <input
          type="text"
          value={eta}
          onChange={(e) => setEta(e.target.value)}
          placeholder="Approx. arrival time"
          className="mt-2 w-full rounded-lg border border-[var(--color-hotel-border)] bg-black/40 p-2 text-white"
        />
      </label>
      <button
        type="button"
        className="w-full rounded-lg bg-[var(--color-hotel-accent)] py-3 font-medium text-white"
        onClick={() => onSubmit(count, needsHelp, eta)}
      >
        Send to bell team
      </button>
    </div>
  );
}
