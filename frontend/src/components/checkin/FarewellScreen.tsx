import { useEffect } from 'react';
import { useCheckinStore } from '../../stores/checkinStore';

export function FarewellScreen() {
  const { guest, selectedRoom, resetSession } = useCheckinStore();

  // Auto-reset after 15 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      resetSession();
    }, 15000);
    return () => clearTimeout(timer);
  }, [resetSession]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 gap-8 text-center">
      {/* Success animation */}
      <div className="relative w-24 h-24">
        <div className="absolute inset-0 rounded-full bg-hotel-success/10 border border-hotel-success/30 flex items-center justify-center animate-[scale-in_0.5s_ease-out]">
          <svg className="w-12 h-12 text-hotel-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="absolute inset-[-8px] rounded-full border border-hotel-success/20 animate-ping" />
      </div>

      <div>
        <h2 className="text-3xl font-light text-hotel-text">
          Welcome, {guest?.firstName || 'valued guest'}!
        </h2>
        <p className="text-hotel-text-dim text-lg mt-2">
          You're all set for your stay
        </p>
      </div>

      {/* Room details summary */}
      <div className="glass-panel p-6 max-w-sm w-full">
        <div className="text-center space-y-2">
          <p className="text-hotel-text-dim text-xs uppercase tracking-wider">Your Room</p>
          <p className="text-hotel-accent text-3xl font-light">
            {selectedRoom?.roomNumber || '---'}
          </p>
          <p className="text-hotel-text-dim text-sm">
            Floor {selectedRoom?.floor} · {selectedRoom?.type}
          </p>
        </div>
      </div>

      {/* Quick info */}
      <div className="max-w-md space-y-2 text-sm text-hotel-text-dim">
        <p>🍳 Breakfast is served from 6:30 AM - 10:30 AM in the Azure Restaurant</p>
        <p>📶 Wi-Fi Password: <span className="text-hotel-accent font-mono">AZURE2024</span></p>
        <p>📞 Front Desk: Dial 0 from your room phone</p>
      </div>

      <p className="text-hotel-text-dim/40 text-xs mt-8">
        This screen will return to the welcome page shortly
      </p>

      <button
        onClick={resetSession}
        className="text-hotel-text-dim/40 text-xs hover:text-hotel-text-dim transition-colors"
      >
        Tap to start new check-in
      </button>
    </div>
  );
}
