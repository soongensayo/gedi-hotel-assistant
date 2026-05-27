import { useMemo } from 'react';
import { JitsiMeeting } from '../components/JitsiMeeting';
import { jitsiRoomName, STANFORD_ROOM_ID } from '../config';
import { useStanfordStaff } from '../hooks/useStanfordStaff';
import { ActionPanel } from './ActionPanel';
import { ArtifactViewer } from './ArtifactViewer';
import { CheckinGuide } from './CheckinGuide';
import { EventLog } from './EventLog';
import { FlowTracker } from './FlowTracker';
import { pushReservationCommand } from './reservationCommands';
import { ReservationLookup } from './ReservationLookup';

export function StaffApp() {
  const roomId = STANFORD_ROOM_ID;
  const staff = useStanfordStaff(roomId);
  const meetingRoom = jitsiRoomName(roomId);

  const completedEventTypes = useMemo(
    () => new Set(staff.eventLog.map((e) => e.event.type)),
    [staff.eventLog]
  );

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3 md:flex-row md:gap-4 md:overflow-hidden md:p-4">
      {/* Left: video + flow tracker + event log */}
      <div className="flex min-h-[40vh] flex-1 flex-col gap-3 md:min-h-0">
        <p className="shrink-0 text-center text-xs text-[var(--color-hotel-text-dim)]">
          Concierge video ·{' '}
          <span className="font-mono text-[var(--color-hotel-accent)]">{meetingRoom}</span>
        </p>
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--color-hotel-border)]">
          <JitsiMeeting
            roomName={meetingRoom}
            displayName="Concierge"
            isGuest={false}
          />
        </div>
        <FlowTracker
          guestPhase={staff.guestPhase}
          guestScreen={staff.guestScreen}
          completedEventTypes={completedEventTypes}
        />
        <div className="shrink-0 rounded-lg border border-[var(--color-hotel-border)] bg-black/40 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-[var(--color-hotel-accent)]">
            Event log
          </p>
          <EventLog entries={staff.eventLog} />
        </div>
      </div>

      {/* Right: controls + artifacts */}
      <aside className="flex w-full shrink-0 flex-col gap-3 md:w-[380px] md:overflow-y-auto">
        <ReservationLookup
          onPushReservation={(r) => pushReservationCommand(staff.pushCommand, r)}
        />
        <CheckinGuide
          guestPhase={staff.guestPhase}
          guestScreen={staff.guestScreen}
          completedEventTypes={completedEventTypes}
        />
        <ArtifactViewer
          signatureDataUrl={staff.signatureDataUrl}
          passportPhotoUrl={staff.passportPhotoUrl}
          passportNumber={staff.passportNumber}
          preferences={staff.preferences}
          selectedServices={staff.selectedServices}
          luggageInfo={staff.luggageInfo}
        />
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-[var(--color-hotel-accent)]">
            Guest actions
          </p>
          <ActionPanel push={staff.pushCommand} />
        </div>
      </aside>
    </div>
  );
}
