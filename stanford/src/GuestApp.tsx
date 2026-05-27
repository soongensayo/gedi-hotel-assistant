import { STANFORD_ROOM_ID } from './config';
import { useStanfordGuest } from './hooks/useStanfordGuest';
import { CheckinCompleteScreen } from './screens/CheckinCompleteScreen';
import { CheckinOptionsScreen } from './screens/CheckinOptionsScreen';
import { ConciergeCallScreen } from './screens/ConciergeCallScreen';
import { MediaScreen } from './screens/MediaScreen';
import { StubMessageScreen } from './screens/StubScreens';
import { WelcomeScreen } from './screens/WelcomeScreen';

export function GuestApp() {
  const roomId = STANFORD_ROOM_ID;
  const stanford = useStanfordGuest(roomId);
  const { phase, setPhase, sendToStaff } = stanford;

  if (phase === 'welcome') {
    return (
      <WelcomeScreen onReadyToCheckIn={() => setPhase('checkin-options')} />
    );
  }

  if (phase === 'checkin-options') {
    return (
      <CheckinOptionsScreen
        onBack={() => setPhase('welcome')}
        onChoose={(opt) => {
          if (opt === 'desk') setPhase('stub-front-desk');
          else if (opt === 'ai') setPhase('stub-ai');
          else setPhase('concierge');
        }}
      />
    );
  }

  if (phase === 'stub-front-desk') {
    return (
      <StubMessageScreen variant="desk" onBack={() => setPhase('welcome')} />
    );
  }

  if (phase === 'stub-ai') {
    return <StubMessageScreen variant="ai" onBack={() => setPhase('welcome')} />;
  }

  if (phase === 'concierge') {
    return <ConciergeCallScreen roomId={roomId} stanford={stanford} />;
  }

  if (phase === 'checkin-complete') {
    return (
      <CheckinCompleteScreen
        reservation={stanford.reservation}
        onContinue={() => setPhase('media')}
      />
    );
  }

  if (phase === 'media') {
    return (
      <MediaScreen
        onCallConcierge={() => {
          sendToStaff({ type: 'call_concierge' });
          stanford.setActiveScreen('video-only');
          setPhase('concierge');
        }}
      />
    );
  }

  return null;
}
