type Option = 'desk' | 'ai' | 'concierge';

type Props = {
  onChoose: (option: Option) => void;
  onBack: () => void;
};

export function CheckinOptionsScreen({ onChoose, onBack }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <button
        type="button"
        className="absolute left-6 top-6 text-sm text-[var(--color-hotel-text-dim)] underline"
        onClick={onBack}
      >
        Back
      </button>
      <h2 className="text-center text-2xl text-[var(--color-hotel-text)]">
        How would you like to check in?
      </h2>
      <div className="flex w-full max-w-md flex-col gap-4">
        <button
          type="button"
          className="rounded-xl border border-[var(--color-hotel-border)] bg-white/5 px-6 py-4 text-left transition hover:border-[var(--color-hotel-accent)]"
          onClick={() => onChoose('desk')}
        >
          <span className="text-lg text-[var(--color-hotel-accent)]">Check in at the front desk</span>
          <p className="mt-1 text-sm text-[var(--color-hotel-text-dim)]">
            We’ll guide you to complete check-in when you arrive at the hotel.
          </p>
        </button>
        <button
          type="button"
          className="rounded-xl border border-[var(--color-hotel-border)] bg-white/5 px-6 py-4 text-left transition hover:border-[var(--color-hotel-accent)]"
          onClick={() => onChoose('ai')}
        >
          <span className="text-lg text-[var(--color-hotel-accent)]">Check in with an AI agent</span>
          <p className="mt-1 text-sm text-[var(--color-hotel-text-dim)]">
            Coming soon for this showcase build.
          </p>
        </button>
        <button
          type="button"
          className="rounded-xl border-2 border-[var(--color-hotel-accent)] bg-[var(--color-hotel-accent)]/10 px-6 py-4 text-left transition hover:bg-[var(--color-hotel-accent)]/20"
          onClick={() => onChoose('concierge')}
        >
          <span className="text-lg text-[var(--color-hotel-accent)]">
            Connect me to a Human intendant
          </span>
          <p className="mt-1 text-sm text-[var(--color-hotel-text-dim)]">
            Video chat with our concierge for a personal check-in.
          </p>
        </button>
      </div>
    </div>
  );
}
