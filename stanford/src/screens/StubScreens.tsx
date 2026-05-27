import { GuestPortraitShell } from '../components/GuestPortraitShell';

type Props = {
  variant: 'desk' | 'ai';
  onBack: () => void;
};

export function StubMessageScreen({ variant, onBack }: Props) {
  const title = variant === 'desk' ? 'Front desk check-in' : 'AI agent check-in';
  const body =
    variant === 'desk'
      ? 'Please proceed to the front desk when you arrive at the hotel. Our team will complete your check-in there.'
      : 'The AI-guided check-in path is not part of this Stanford showcase yet. Please choose Human intendant or front desk.';

  return (
    <GuestPortraitShell>
      <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-8 py-12 text-center">
        <h2 className="text-3xl text-[var(--color-hotel-accent)]">{title}</h2>
        <p className="mt-4 max-w-md text-[var(--color-hotel-text-dim)]">{body}</p>
        <button
          type="button"
          className="mt-8 rounded-full border border-[var(--color-hotel-accent)] px-8 py-3 text-[var(--color-hotel-accent)]"
          onClick={onBack}
        >
          Back to welcome
        </button>
      </div>
    </GuestPortraitShell>
  );
}
