import { useCheckinStore } from '../../stores/checkinStore';
import { useConversationStore } from '../../stores/conversationStore';

export function WelcomeScreen() {
  const setStep = useCheckinStore((s) => s.setStep);
  const addMessage = useConversationStore((s) => s.addMessage);

  const handleBegin = () => {
    addMessage({
      role: 'assistant',
      content: 'Welcome to The Grand Azure Hotel! I\'m your AI concierge and I\'ll be helping you check in today. How would you like to proceed — would you like to scan your passport, or enter your confirmation code?',
    });
    setStep('identify');
  };

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-8">
      {/* Hotel logo area */}
      <div className="flex flex-col items-center gap-4">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-hotel-accent/20 to-hotel-accent-2/20 border border-hotel-accent/30 flex items-center justify-center shadow-[0_0_40px_rgba(0,212,255,0.15)]">
          <svg className="w-12 h-12 text-hotel-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>

        <div>
          <h1 className="text-4xl font-light tracking-wide text-hotel-text">
            The Grand Azure
          </h1>
          <p className="text-hotel-gold text-lg font-light tracking-widest uppercase mt-1">
            Hotel & Residences
          </p>
        </div>
      </div>

      {/* Tagline */}
      <p className="text-hotel-text-dim text-lg font-light max-w-md">
        Welcome. Tap below to begin your seamless AI-powered check-in experience.
      </p>

      {/* Start button */}
      <button
        onClick={handleBegin}
        className="group relative px-12 py-5 rounded-2xl bg-hotel-accent/10 border border-hotel-accent/30 text-hotel-accent text-lg font-medium tracking-wide transition-all duration-500 hover:bg-hotel-accent/20 hover:border-hotel-accent/50 hover:shadow-[0_0_40px_rgba(0,212,255,0.25)] active:scale-[0.97]"
      >
        <span className="relative z-10">Begin Check-in</span>
        {/* Animated gradient background */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-hotel-accent/5 via-hotel-accent/10 to-hotel-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      </button>

      {/* Current time */}
      <p className="text-hotel-text-dim/50 text-sm">
        {new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </p>
    </div>
  );
}
