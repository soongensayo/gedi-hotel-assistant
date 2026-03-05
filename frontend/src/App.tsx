import { useCheckinStore } from './stores/checkinStore';
import { AvatarDisplay } from './components/avatar/AvatarDisplay';
import { ChatPanel } from './components/conversation/ChatPanel';
import { ProgressBar } from './components/ui/ProgressBar';
import { WelcomeScreen } from './components/checkin/WelcomeScreen';
import { PassportScanScreen } from './components/checkin/PassportScanScreen';
import { ReservationFoundScreen } from './components/checkin/ReservationFoundScreen';
// import { RoomSelectionScreen } from './components/checkin/RoomSelectionScreen'; // Room pre-selected on booking website
import { UpgradeOfferScreen } from './components/checkin/UpgradeOfferScreen';
import { PaymentScreen } from './components/checkin/PaymentScreen';
import { KeyCardScreen } from './components/checkin/KeyCardScreen';

/**
 * Steps that show as a centered overlay panel on top of the avatar.
 */
const OVERLAY_STEPS = ['passport-scan', 'reservation-found', 'upgrade-offer', 'payment', 'key-card'];

/** Overlay content — only the wizard screens that appear as modals */
function CheckinOverlayContent() {
  const currentStep = useCheckinStore((s) => s.currentStep);
  switch (currentStep) {
    case 'passport-scan':
      return <PassportScanScreen />;
    case 'reservation-found':
      return <ReservationFoundScreen />;
    case 'upgrade-offer':
      return <UpgradeOfferScreen />;
    case 'payment':
      return <PaymentScreen />;
    case 'key-card':
      return <KeyCardScreen />;
    default:
      return null;
  }
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
