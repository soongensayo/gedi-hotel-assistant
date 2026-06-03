import { useEffect, useState } from 'react';
import { STANFORD_ROOM_ID } from './config';
import { AmbientJazz } from './components/AmbientJazz';
import { useStanfordGuest } from './hooks/useStanfordGuest';
import { CheckinCompleteScreen } from './screens/CheckinCompleteScreen';
import { CheckinOptionsScreen } from './screens/CheckinOptionsScreen';
import { ConciergeCallScreen } from './screens/ConciergeCallScreen';
import { MediaScreen } from './screens/MediaScreen';
import { StubMessageScreen } from './screens/StubScreens';
import { WelcomeScreen } from './screens/WelcomeScreen';

const GUEST_THEME_STORAGE_KEY = 'stanford-guest-wood-theme';

export function GuestApp() {
  const roomId = STANFORD_ROOM_ID;
  const stanford = useStanfordGuest(roomId);
  const { phase, setPhase, sendToStaff } = stanford;
  const [woodThemeActive, setWoodThemeActive] = useState(() => {
    try {
      return window.localStorage.getItem(GUEST_THEME_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        GUEST_THEME_STORAGE_KEY,
        String(woodThemeActive)
      );
    } catch {
      // Theme persistence is a nicety; the visible toggle should still work.
    }
  }, [woodThemeActive]);

  const ambience = (
    <AmbientJazz
      enabled={phase !== 'concierge'}
      woodThemeActive={woodThemeActive}
      onToggleWoodTheme={() => setWoodThemeActive((current) => !current)}
    />
  );

  const guestThemeClassName = woodThemeActive ? 'guest-interface guest-theme-wood' : 'guest-interface';
  let screen = null;

  if (phase === 'welcome') {
    screen = (
      <>
        {ambience}
        <WelcomeScreen onReadyToCheckIn={() => setPhase('checkin-options')} />
      </>
    );
  } else if (phase === 'checkin-options') {
    screen = (
      <>
        {ambience}
        <CheckinOptionsScreen
          onBack={() => setPhase('welcome')}
          onChoose={(opt) => {
            if (opt === 'desk') setPhase('stub-front-desk');
            else if (opt === 'ai') setPhase('stub-ai');
            else setPhase('concierge');
          }}
        />
      </>
    );
  } else if (phase === 'stub-front-desk') {
    screen = (
      <>
        {ambience}
        <StubMessageScreen variant="desk" onBack={() => setPhase('welcome')} />
      </>
    );
  } else if (phase === 'stub-ai') {
    screen = (
      <>
        {ambience}
        <StubMessageScreen variant="ai" onBack={() => setPhase('welcome')} />
      </>
    );
  } else if (phase === 'concierge') {
    screen = <ConciergeCallScreen roomId={roomId} stanford={stanford} />;
  } else if (phase === 'checkin-complete') {
    screen = (
      <>
        {ambience}
        <CheckinCompleteScreen
          reservation={stanford.reservation}
          onContinue={() => setPhase('media')}
        />
      </>
    );
  } else if (phase === 'media') {
    screen = (
      <>
        {ambience}
        <MediaScreen
          onCallConcierge={() => {
            sendToStaff({ type: 'call_concierge' });
            stanford.setActiveScreen('video-only');
            setPhase('concierge');
          }}
        />
      </>
    );
  }

  return <div className={`h-full w-full ${guestThemeClassName}`}>{screen}</div>;
}
