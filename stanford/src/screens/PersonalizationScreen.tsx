import { useState } from 'react';

type Props = {
  onSubmit: (data: { temperature: number; pillows: string; celebration: string }) => void;
};

export function PersonalizationScreen({ onSubmit }: Props) {
  const [temperature, setTemperature] = useState(22);
  const [pillows, setPillows] = useState('standard');
  const [celebration, setCelebration] = useState('');

  return (
    <div className="space-y-4">
      <h3 className="text-center text-xl text-[var(--color-hotel-accent)]">
        Personalize your stay
      </h3>
      <label className="block text-sm">
        <span className="text-[var(--color-hotel-text-dim)]">Room temperature (°C)</span>
        <input
          type="range"
          min={18}
          max={26}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
          className="mt-2 w-full"
        />
        <span className="text-[var(--color-hotel-accent)]">{temperature}°C</span>
      </label>
      <label className="block text-sm">
        <span className="text-[var(--color-hotel-text-dim)]">Pillows</span>
        <select
          value={pillows}
          onChange={(e) => setPillows(e.target.value)}
          className="mt-2 w-full rounded-lg border border-[var(--color-hotel-border)] bg-black/40 p-2 text-white"
        >
          <option value="standard">Standard</option>
          <option value="extra-soft">Extra soft</option>
          <option value="firm">Firm</option>
          <option value="hypoallergenic">Hypoallergenic</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-[var(--color-hotel-text-dim)]">Celebration or special note</span>
        <input
          type="text"
          value={celebration}
          onChange={(e) => setCelebration(e.target.value)}
          placeholder="Anniversary, birthday…"
          className="mt-2 w-full rounded-lg border border-[var(--color-hotel-border)] bg-black/40 p-2 text-white placeholder:text-white/30"
        />
      </label>
      <button
        type="button"
        className="w-full rounded-lg bg-[var(--color-hotel-accent)] py-3 font-medium text-black"
        onClick={() => onSubmit({ temperature, pillows, celebration })}
      >
        Save preferences
      </button>
    </div>
  );
}
