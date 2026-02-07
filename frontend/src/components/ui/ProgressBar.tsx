import type { CheckinStep } from '../../types';

const STEPS: { key: CheckinStep; label: string }[] = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'identify', label: 'Identify' },
  { key: 'passport-scan', label: 'Passport' },
  { key: 'reservation-found', label: 'Reservation' },
  { key: 'room-selection', label: 'Room' },
  { key: 'upgrade-offer', label: 'Upgrade' },
  { key: 'payment', label: 'Payment' },
  { key: 'key-card', label: 'Key Card' },
  { key: 'farewell', label: 'Done' },
];

interface ProgressBarProps {
  currentStep: CheckinStep;
}

export function ProgressBar({ currentStep }: ProgressBarProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);

  // Don't show on welcome or farewell
  if (currentStep === 'welcome' || currentStep === 'farewell') return null;

  return (
    <div className="flex items-center gap-1 px-6 py-3">
      {STEPS.filter((s) => s.key !== 'welcome' && s.key !== 'farewell').map((step, index) => {
        const stepIndex = STEPS.findIndex((s) => s.key === step.key);
        const isActive = stepIndex === currentIndex;
        const isCompleted = stepIndex < currentIndex;

        return (
          <div key={step.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={`
                  w-2.5 h-2.5 rounded-full transition-all duration-500
                  ${isActive ? 'bg-hotel-accent shadow-[0_0_10px_rgba(0,212,255,0.6)] scale-125' : ''}
                  ${isCompleted ? 'bg-hotel-accent/70' : ''}
                  ${!isActive && !isCompleted ? 'bg-white/15' : ''}
                `}
              />
              <span
                className={`
                  text-[10px] mt-1 transition-colors duration-300
                  ${isActive ? 'text-hotel-accent' : ''}
                  ${isCompleted ? 'text-hotel-text-dim' : ''}
                  ${!isActive && !isCompleted ? 'text-white/20' : ''}
                `}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.filter((s) => s.key !== 'welcome' && s.key !== 'farewell').length - 1 && (
              <div
                className={`
                  h-px flex-1 mx-1 transition-colors duration-500
                  ${stepIndex < currentIndex ? 'bg-hotel-accent/40' : 'bg-white/10'}
                `}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
