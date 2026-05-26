import { JitsiMeeting } from '../components/JitsiMeeting';
import { ScreenOverlay } from '../components/ScreenOverlay';
import { jitsiRoomName } from '../config';
import { useStanfordGuest } from '../hooks/useStanfordGuest';
import { KeyCardScreen } from './KeyCardScreen';
import { LuggageScreen } from './LuggageScreen';
import { PassportScanScreen } from './PassportScanScreen';
import { PaymentScreen } from './PaymentScreen';
import { PersonalizationScreen } from './PersonalizationScreen';
import { PropertyTourScreen } from './PropertyTourScreen';
import { ReservationScreen } from './ReservationScreen';
import { ServicesScreen } from './ServicesScreen';
import { SignatureScreen } from './SignatureScreen';

type StanfordGuest = ReturnType<typeof useStanfordGuest>;

type Props = {
  roomId: string;
  stanford: StanfordGuest;
};

const useNfcHardware = import.meta.env.VITE_STANFORD_USE_NFC === 'true';
const fallbackKeyGuest =
  (import.meta.env.VITE_STANFORD_KEY_GUEST as string | undefined) ?? 'Stanford Guest';
const fallbackKeyRoom =
  (import.meta.env.VITE_STANFORD_KEY_ROOM as string | undefined) ?? '311';

export function ConciergeCallScreen({ roomId, stanford }: Props) {
  const {
    activeScreen,
    reservation,
    paymentQr,
    services,
    customMessage,
    passportScanMode,
    sendToStaff,
    setActiveScreen,
  } = stanford;

  const showOverlay = activeScreen !== 'video-only';
  const meetingRoom = jitsiRoomName(roomId);
  const sendToStaffAndClose = (event: Parameters<typeof sendToStaff>[0]) => {
    sendToStaff(event);
    setActiveScreen('video-only');
  };

  const overlayInner = () => {
    switch (activeScreen) {
      case 'reservation':
        return reservation ? (
          <ReservationScreen
            reservation={reservation}
            onConfirm={() =>
              sendToStaffAndClose({
                type: 'reservation_confirmed',
                reservationId: reservation.id,
              })
            }
          />
        ) : (
          <p className="py-8 text-center text-white/70">
            Waiting for your concierge to share reservation details…
          </p>
        );
      case 'passport':
        return (
          <PassportScanScreen
            mode={passportScanMode}
            onComplete={(passportNumber, photoDataUrl) =>
              sendToStaffAndClose({ type: 'passport_scanned', passportNumber, photoDataUrl })
            }
          />
        );
      case 'payment':
        return paymentQr ? (
          <PaymentScreen
            qrValue={paymentQr.qrValue}
            instructions={paymentQr.instructions}
            onPaidDemo={() => sendToStaffAndClose({ type: 'payment_complete' })}
          />
        ) : (
          <p className="py-8 text-center text-white/70">Payment instructions loading…</p>
        );
      case 'signature':
        return (
          <SignatureScreen
            onSubmit={(dataUrl) =>
              sendToStaffAndClose({ type: 'signature_submitted', dataUrl })
            }
          />
        );
      case 'key-card': {
        const guestName = reservation?.guest
          ? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim()
          : fallbackKeyGuest;
        const roomNumber = reservation?.room?.roomNumber ?? fallbackKeyRoom;
        return (
          <KeyCardScreen
            useHardwareNfc={useNfcHardware}
            guestName={guestName}
            roomNumber={roomNumber}
            onReceived={() => sendToStaffAndClose({ type: 'key_card_received' })}
          />
        );
      }
      case 'personalization':
        return (
          <PersonalizationScreen
            onSubmit={({ temperature, pillows, celebration }) =>
              sendToStaffAndClose({
                type: 'preferences_submitted',
                temperature,
                pillows,
                celebration: celebration || undefined,
              })
            }
          />
        );
      case 'services':
        return (
          <ServicesScreen
            services={services}
            onSelect={(s) =>
              sendToStaffAndClose({
                type: 'service_selected',
                serviceId: s.id,
                label: s.name,
              })
            }
          />
        );
      case 'property-tour':
        return <PropertyTourScreen />;
      case 'luggage':
        return (
          <LuggageScreen
            onSubmit={(count, needsHelp, etaNote) =>
              sendToStaffAndClose({
                type: 'luggage_info',
                count,
                needsHelp,
                etaNote: etaNote || undefined,
              })
            }
          />
        );
      case 'custom':
        return customMessage ? (
          <div className="space-y-3 text-center">
            {customMessage.title && (
              <h3 className="text-xl text-[var(--color-hotel-accent)]">
                {customMessage.title}
              </h3>
            )}
            <p className="text-white/85">{customMessage.body}</p>
          </div>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <div className="relative h-full w-full bg-black">
      <JitsiMeeting
        roomName={meetingRoom}
        displayName={`Guest · ${roomId}`}
        isGuest
      />
      <ScreenOverlay open={showOverlay}>{overlayInner()}</ScreenOverlay>
    </div>
  );
}
