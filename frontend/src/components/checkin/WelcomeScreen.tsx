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

  const handleVideoCall = () => {
    setStep('video-call');
  };

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-8 gap-8">
      {/* Hotel logo area */}
      <div className="flex flex-col items-center gap-4">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-hotel-accent/15 to-hotel-accent-2/15 border border-hotel-accent/20 flex items-center justify-center shadow-[0_0_40px_rgba(196,162,101,0.1)]">
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

      {/* Primary: AI check-in */}
      <button
        onClick={handleBegin}
        className="group relative px-12 py-5 rounded-2xl bg-hotel-accent/10 border border-hotel-accent/25 text-hotel-accent text-lg font-medium tracking-wide transition-all duration-500 hover:bg-hotel-accent/18 hover:border-hotel-accent/40 hover:shadow-[0_0_40px_rgba(196,162,101,0.15)] active:scale-[0.97]"
      >
        <span className="relative z-10">Begin Check-in</span>
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-hotel-accent/3 via-hotel-accent/8 to-hotel-accent/3 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      </button>

      {/* Divider */}
      <div className="flex items-center gap-4 w-full max-w-xs">
        <div className="flex-1 h-px bg-white/8" />
        <span className="text-hotel-text-dim/40 text-xs tracking-widest uppercase">or</span>
        <div className="flex-1 h-px bg-white/8" />
      </div>

      {/* Secondary: speak with a human */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={handleVideoCall}
          className="group flex items-center gap-2.5 px-6 py-3 rounded-xl border border-white/10 text-hotel-text-dim text-sm font-light tracking-wide transition-all duration-300 hover:border-white/20 hover:text-hotel-text hover:bg-white/3 active:scale-[0.98]"
        >
          <svg className="w-4 h-4 opacity-60 group-hover:opacity-80 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          Speak with a staff member
        </button>
        <p className="text-hotel-text-dim/35 text-xs font-light">
          Prefer human assistance? Connect with our front desk via video call.
        </p>
      </div>

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
