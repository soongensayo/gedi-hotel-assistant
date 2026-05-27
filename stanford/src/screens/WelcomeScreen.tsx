import { SwipeableWidgets } from '../components/SwipeableWidgets';

type Props = {
  onReadyToCheckIn: () => void;
};

export function WelcomeScreen({ onReadyToCheckIn }: Props) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--color-hotel-dark)] px-5 py-5 md:px-10 md:py-8">
      <header className="flex items-center justify-between text-xs uppercase tracking-widest text-white/45">
        <span>LuxeDrive Arrival</span>
        <span className="text-[var(--color-hotel-accent)]">Singapore</span>
      </header>

      <main className="grid min-h-0 flex-1 items-center gap-6 py-6 md:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.75fr)] md:py-8">
        <section className="max-w-2xl">
          <p className="mb-4 text-sm uppercase tracking-widest text-[var(--color-hotel-accent)]">
            Concierge online
          </p>
          <h1 className="text-4xl leading-tight tracking-wide text-[var(--color-hotel-text)] md:text-6xl">
            Welcome to Singapore.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-[var(--color-hotel-text-dim)] md:text-xl">
            Your arrival is ready. A concierge can verify your reservation, complete
            check-in, and prepare your room key from this screen.
          </p>

          <div className="mt-8 grid max-w-xl grid-cols-3 gap-3 text-center">
            {[
              ['Reservation', 'Ready'],
              ['Identity', 'Guided'],
              ['Room key', 'Queued'],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-[var(--color-hotel-border)] bg-white/[0.04] px-3 py-4"
              >
                <p className="text-[10px] uppercase tracking-widest text-white/35">{label}</p>
                <p className="mt-2 text-sm text-[var(--color-hotel-text)]">{value}</p>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-9 rounded-lg border border-[var(--color-hotel-accent)] bg-[var(--color-hotel-accent)] px-8 py-4 text-base font-medium tracking-wide text-black shadow-[0_18px_40px_rgba(197,160,89,0.22)] transition hover:bg-[var(--color-hotel-gold)] active:scale-[0.99]"
            onClick={onReadyToCheckIn}
          >
            Begin check-in
          </button>
        </section>

        <aside className="min-h-0">
          <SwipeableWidgets />
        </aside>
      </main>

      <footer className="grid grid-cols-3 gap-2 border-t border-[var(--color-hotel-border)] pt-4 text-center text-xs uppercase tracking-widest text-white/35">
        <span>Private transfer</span>
        <span>Marina Bay</span>
        <span>Front desk connected</span>
      </footer>
    </div>
  );
}
