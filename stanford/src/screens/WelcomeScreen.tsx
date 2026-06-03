import { GuestPortraitShell } from '../components/GuestPortraitShell';
import { SingaporeClockCard } from '../components/SwipeableWidgets';

type Props = {
  onReadyToCheckIn: () => void;
};

export function WelcomeScreen({ onReadyToCheckIn }: Props) {
  return (
    <GuestPortraitShell>
      <div className="flex h-full flex-col px-5 py-5 md:px-10 md:py-8">
        <header className="flex items-center text-xs uppercase tracking-widest text-[var(--color-hotel-text-dim)]">
          <span>PrimeDrive Arrival</span>
        </header>

        <main className="flex min-h-0 flex-1 items-center overflow-y-auto py-4 md:py-6">
          <section className="w-full max-w-4xl">
            <p className="mb-3 text-sm uppercase tracking-widest text-[var(--color-hotel-accent)]">
              Concierge online
            </p>
            <h1 className="text-4xl leading-tight tracking-wide text-[var(--color-hotel-text)] md:text-6xl">
              Welcome to Singapore.
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--color-hotel-text-dim)] md:text-xl">
              Your arrival is ready. A concierge can verify your reservation, complete
              check-in, and prepare your room key from this screen.
            </p>

            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              {[
                ['Reservation', 'Ready'],
                ['Identity', 'Guided'],
                ['Room key', 'Queued'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-[var(--color-hotel-border)] bg-[var(--guest-card)] px-3 py-4 shadow-[0_12px_34px_rgba(31,106,88,0.08)]"
                >
                  <p className="text-[10px] uppercase tracking-widest text-[var(--color-hotel-text-dim)]">{label}</p>
                  <p className="mt-2 text-sm text-[var(--color-hotel-text)]">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 grid max-w-2xl gap-4">
              <SingaporeClockCard compact />
              <button
                type="button"
                className="rounded-lg border border-[var(--color-hotel-accent)] bg-[var(--color-hotel-accent)] px-8 py-4 text-base font-medium tracking-wide text-white shadow-[0_18px_40px_rgba(197,160,89,0.22)] transition hover:bg-[var(--color-hotel-gold)] active:scale-[0.99] md:text-lg"
                onClick={onReadyToCheckIn}
              >
                Begin check-in
              </button>
            </div>
          </section>
        </main>
      </div>
    </GuestPortraitShell>
  );
}
