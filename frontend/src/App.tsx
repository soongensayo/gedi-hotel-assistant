import { useState, useCallback } from 'react';
import { useCheckinStore } from './stores/checkinStore';
import { AvatarDisplay } from './components/avatar/AvatarDisplay';
import { ChatPanel } from './components/conversation/ChatPanel';
import { ProgressBar } from './components/ui/ProgressBar';
import { WelcomeScreen } from './components/checkin/WelcomeScreen';
import { ReservationFoundScreen } from './components/checkin/ReservationFoundScreen';
import { RoomSelectionScreen } from './components/checkin/RoomSelectionScreen';
import { UpgradeOfferScreen } from './components/checkin/UpgradeOfferScreen';
import { KeyCardScreen } from './components/checkin/KeyCardScreen';
import { useCheckin } from './hooks/useCheckin';

/**
 * Steps that show as a centered overlay panel on top of the avatar.
 */
const OVERLAY_STEPS = ['reservation-found', 'room-selection', 'upgrade-offer', 'key-card'];

/** Overlay content — only the wizard screens that appear as modals */
function CheckinOverlayContent() {
  const currentStep = useCheckinStore((s) => s.currentStep);
  switch (currentStep) {
    case 'reservation-found':
      return <ReservationFoundScreen />;
    case 'room-selection':
      return <RoomSelectionScreen />;
    case 'upgrade-offer':
      return <UpgradeOfferScreen />;
    case 'key-card':
      return <KeyCardScreen />;
    default:
      return null;
  }
}

/**
 * Small floating action buttons for passport scan & credit card.
 * These replace the full-screen PassportScanScreen and PaymentScreen.
 */
function ActionButtons() {
  const currentStep = useCheckinStore((s) => s.currentStep);
  const reservation = useCheckinStore((s) => s.reservation);
  const selectedUpgrade = useCheckinStore((s) => s.selectedUpgrade);
  const { handlePassportScan, handlePayment } = useCheckin();
  const [scanningPassport, setScanningPassport] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);

  const isPassportActive = currentStep === 'passport-scan';
  const isPaymentActive = currentStep === 'payment';

  // Compute total amount for payment label
  const totalAmount = reservation
    ? reservation.totalAmount +
      (selectedUpgrade
        ? selectedUpgrade.additionalCostPerNight *
          Math.ceil(
            (new Date(reservation.checkOutDate).getTime() -
              new Date(reservation.checkInDate).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : 0)
    : 0;

  const doPassportScan = useCallback(async () => {
    setScanningPassport(true);
    await handlePassportScan();
    setScanningPassport(false);
  }, [handlePassportScan]);

  const doPayment = useCallback(async () => {
    setProcessingPayment(true);
    await handlePayment();
    setProcessingPayment(false);
  }, [handlePayment]);

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3 z-20">
      {/* Passport Scan button */}
      <button
        onClick={doPassportScan}
        disabled={scanningPassport}
        className={`
          px-4 py-2.5 text-sm rounded-xl backdrop-blur-md transition-all duration-300 flex items-center gap-2 font-medium
          ${isPassportActive
            ? 'bg-hotel-accent/20 border-2 border-hotel-accent/50 text-hotel-accent shadow-[0_0_25px_rgba(0,212,255,0.3)] scale-105'
            : 'bg-hotel-panel/80 border border-hotel-border text-hotel-text-dim hover:text-hotel-accent hover:border-hotel-accent/30 hover:bg-hotel-accent/10'
          }
          ${scanningPassport ? 'animate-pulse' : ''}
        `}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
        </svg>
        {scanningPassport ? 'Scanning...' : 'Passport Scan'}
      </button>

      {/* Credit Card button */}
      <button
        onClick={doPayment}
        disabled={processingPayment || !reservation}
        className={`
          px-4 py-2.5 text-sm rounded-xl backdrop-blur-md transition-all duration-300 flex items-center gap-2 font-medium
          ${isPaymentActive
            ? 'bg-hotel-accent/20 border-2 border-hotel-accent/50 text-hotel-accent shadow-[0_0_25px_rgba(0,212,255,0.3)] scale-105'
            : 'bg-hotel-panel/80 border border-hotel-border text-hotel-text-dim hover:text-hotel-accent hover:border-hotel-accent/30 hover:bg-hotel-accent/10'
          }
          ${processingPayment ? 'animate-pulse' : ''}
        `}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
        </svg>
        {processingPayment
          ? 'Processing...'
          : isPaymentActive && reservation
            ? `Pay ${reservation.currency} ${totalAmount.toLocaleString()}`
            : 'Credit Card'}
      </button>
    </div>
  );
}

function App() {
  const currentStep = useCheckinStore((s) => s.currentStep);
  const isWelcome = currentStep === 'welcome';
  const showOverlay = OVERLAY_STEPS.includes(currentStep);

  return (
    <div className="h-full w-full flex flex-col bg-hotel-dark overflow-hidden">
      {/* Top bar: progress */}
      <ProgressBar currentStep={currentStep} />

      {/* Main content area */}
      <div className="flex-1 overflow-hidden relative">
        {isWelcome ? (
          <WelcomeScreen />
        ) : (
          <>
            {/* Big Avatar — fills the entire main area */}
            <div className="h-full w-full p-4">
              <AvatarDisplay className="h-full w-full" />
            </div>

            {/* Floating overlay for wizard step content */}
            {showOverlay && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-30 p-4">
                <div className="glass-panel w-full max-w-2xl max-h-[75vh] overflow-y-auto">
                  <CheckinOverlayContent />
                </div>
              </div>
            )}

            {/* Small action buttons — only visible on passport-scan / payment steps */}
            {(currentStep === 'passport-scan' || currentStep === 'payment') && <ActionButtons />}
          </>
        )}
      </div>

      {/* Bottom: Compact chat panel */}
      {!isWelcome && (
        <div className="px-4 pb-2">
          <ChatPanel />
        </div>
      )}
    </div>
  );
}

export default App;
