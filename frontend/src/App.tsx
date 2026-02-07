import { useCheckinStore } from './stores/checkinStore';
import { AvatarDisplay } from './components/avatar/AvatarDisplay';
import { ChatPanel } from './components/conversation/ChatPanel';
import { ProgressBar } from './components/ui/ProgressBar';
import { WelcomeScreen } from './components/checkin/WelcomeScreen';
import { IdentifyScreen } from './components/checkin/IdentifyScreen';
import { PassportScanScreen } from './components/checkin/PassportScanScreen';
import { ReservationFoundScreen } from './components/checkin/ReservationFoundScreen';
import { RoomSelectionScreen } from './components/checkin/RoomSelectionScreen';
import { UpgradeOfferScreen } from './components/checkin/UpgradeOfferScreen';
import { PaymentScreen } from './components/checkin/PaymentScreen';
import { KeyCardScreen } from './components/checkin/KeyCardScreen';
import { FarewellScreen } from './components/checkin/FarewellScreen';

function CheckinStepContent() {
  const currentStep = useCheckinStore((s) => s.currentStep);

  switch (currentStep) {
    case 'welcome':
      return <WelcomeScreen />;
    case 'identify':
      return <IdentifyScreen />;
    case 'passport-scan':
      return <PassportScanScreen />;
    case 'reservation-found':
      return <ReservationFoundScreen />;
    case 'room-selection':
      return <RoomSelectionScreen />;
    case 'upgrade-offer':
      return <UpgradeOfferScreen />;
    case 'payment':
      return <PaymentScreen />;
    case 'key-card':
      return <KeyCardScreen />;
    case 'farewell':
      return <FarewellScreen />;
    default:
      return <WelcomeScreen />;
  }
}

function App() {
  const currentStep = useCheckinStore((s) => s.currentStep);
  const isWelcome = currentStep === 'welcome';
  const isFarewell = currentStep === 'farewell';

  return (
    <div className="h-full w-full flex flex-col bg-hotel-dark overflow-hidden">
      {/* Top bar: progress */}
      <ProgressBar currentStep={currentStep} />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Avatar panel (hidden on welcome/farewell) */}
        {!isWelcome && !isFarewell && (
          <div className="w-80 flex-shrink-0 p-4 flex flex-col gap-4">
            <AvatarDisplay className="flex-1" />
          </div>
        )}

        {/* Center: Check-in wizard content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <CheckinStepContent />
          </div>
        </div>
      </div>

      {/* Bottom: Chat panel (hidden on welcome) */}
      {!isWelcome && (
        <div className="px-4 pb-4">
          <ChatPanel />
        </div>
      )}
    </div>
  );
}

export default App;
