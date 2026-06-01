export function HotelMap() {
  return (
    <div className="space-y-2.5">
      <p className="text-center text-xs leading-5 text-[var(--color-hotel-text-dim)]">
        Property map — your concierge can walk you through each area live.
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {[
          ['Lobby & Arrival', 'Ground'],
          ['Spa & Wellness', 'L3'],
          ['Signature Restaurant', 'L2'],
          ['Sky Pool', 'Rooftop'],
          ['Fitness', 'L4'],
          ['Ballroom / Events', 'L1'],
        ].map(([name, floor]) => (
          <div
            key={name}
            className="rounded-lg border border-[var(--color-hotel-border)] bg-white/5 px-2.5 py-2"
          >
            <p className="text-sm font-medium leading-tight text-[var(--color-hotel-accent)]">{name}</p>
            <p className="text-xs text-[var(--color-hotel-text-dim)]">{floor}</p>
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-white/50">
        A printed map is in the seat-back pocket.
      </p>
    </div>
  );
}
