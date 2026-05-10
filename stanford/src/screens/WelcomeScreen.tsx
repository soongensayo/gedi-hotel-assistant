import { SwipeableWidgets } from '../components/SwipeableWidgets';

type Props = {
  onReadyToCheckIn: () => void;
};

export function WelcomeScreen({ onReadyToCheckIn }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <h1 className="text-center text-3xl tracking-wide text-[var(--color-hotel-text)] md:text-4xl">
        Welcome to Singapore
      </h1>
      <p className="mt-3 max-w-md text-center text-[var(--color-hotel-text-dim)]">
        Your LuxeDrive experience begins here. Relax while we prepare your arrival.
      </p>

      <SwipeableWidgets />

      <button
        type="button"
        className="mt-10 rounded-full border-2 border-[var(--color-hotel-accent)] bg-[var(--color-hotel-accent)]/15 px-10 py-4 text-lg font-medium tracking-wide text-[var(--color-hotel-accent)] shadow-[0_0_24px_rgba(197,160,89,0.25)] transition hover:bg-[var(--color-hotel-accent)]/25"
        onClick={onReadyToCheckIn}
      >
        I am ready to Check in
      </button>
    </div>
  );
}
