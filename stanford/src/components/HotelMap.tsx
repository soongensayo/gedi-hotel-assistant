export function HotelMap() {
  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-[var(--color-hotel-text-dim)]">
        Property map — your concierge can walk you through each area live.
      </p>
      <div className="grid grid-cols-2 gap-3 text-sm">
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
            className="rounded-lg border border-[var(--color-hotel-border)] bg-white/5 px-3 py-3"
          >
            <p className="font-medium text-[var(--color-hotel-accent)]">{name}</p>
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
