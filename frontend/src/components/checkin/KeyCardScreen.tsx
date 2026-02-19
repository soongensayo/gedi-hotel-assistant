import { useEffect, useState } from 'react';
import { useCheckin } from '../../hooks/useCheckin';
import { useCheckinStore } from '../../stores/checkinStore';

export function KeyCardScreen() {
  const { handleCompleteCheckin } = useCheckin();
  const { selectedRoom } = useCheckinStore();
  const [isEncoding, setIsEncoding] = useState(true);
  const [keyCardReady, setKeyCardReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsEncoding(false);
      setKeyCardReady(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!keyCardReady) return;
    const timer = setTimeout(() => {
      handleCompleteCheckin();
    }, 5000);
    return () => clearTimeout(timer);
  }, [keyCardReady, handleCompleteCheckin]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-8 gap-8">
      <h2 className="text-2xl font-light text-hotel-text">
        {isEncoding ? 'Preparing Your Key Card' : 'Key Card Ready'}
      </h2>

      {/* Key card visualization */}
      <div className={`
        relative w-80 h-48 rounded-2xl transition-all duration-1000
        ${keyCardReady
          ? 'bg-gradient-to-br from-hotel-accent/15 via-hotel-accent-2/8 to-hotel-gold/15 border border-hotel-accent/30 shadow-[0_0_30px_rgba(196,162,101,0.12)]'
          : 'bg-hotel-panel border border-hotel-border'
        }
      `}>
        <div className="absolute inset-0 p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-hotel-accent text-xs tracking-widest uppercase font-medium">
                The Grand Azure
              </p>
              <p className="text-hotel-text-dim text-[10px]">Hotel & Residences</p>
            </div>
            {keyCardReady && (
              <div className="w-8 h-6 rounded bg-hotel-gold/30 border border-hotel-gold/40" />
            )}
          </div>

          <div>
            {isEncoding ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-hotel-accent/30 border-t-hotel-accent rounded-full" />
                <span className="text-hotel-accent text-sm animate-pulse">Encoding key card...</span>
              </div>
            ) : (
              <div>
                <p className="text-hotel-text text-2xl font-light">
                  Room {selectedRoom?.roomNumber || '---'}
                </p>
                <p className="text-hotel-text-dim text-xs">
                  Floor {selectedRoom?.floor || '-'} · {selectedRoom?.type || '---'}
                </p>
              </div>
            )}
          </div>
        </div>

        {isEncoding && (
          <div className="absolute inset-0 rounded-2xl overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-hotel-accent to-transparent animate-pulse" />
          </div>
        )}
      </div>

      {keyCardReady && (
        <div className="text-center space-y-3">
          <p className="text-hotel-success text-sm">✓ Key card encoded successfully</p>
          <p className="text-hotel-text-dim text-xs">Please take your key card</p>
          <div className="mt-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
            <p className="text-hotel-text text-sm">
              You can also access your <span className="text-hotel-accent font-medium">digital key</span> anytime via the guest portal
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
