import { useEffect, useRef, useState } from 'react';
import { enableSuccessSoundOnNextGesture, playSuccessSound } from '../audio/successSound';
import { issueKeyCard, type IssueKeyCardResponse } from '../services/api';

type Props = {
  guestName?: string;
  issueKey: string;
  onReceived: () => void;
  roomNumber?: string;
};

type Phase = 'encoding' | 'dispensing' | 'done' | 'error';

type IssueRecord = {
  promise: Promise<IssueKeyCardResponse>;
};

const issueRecords = new Map<string, IssueRecord>();
const notifiedIssueKeys = new Set<string>();

function getIssueRecord(issueKey: string, guestName: string, roomNumber: string) {
  const existing = issueRecords.get(issueKey);
  if (existing) return existing;

  const record = {
    promise: issueKeyCard({
      guestName,
      roomNumber,
      cardLabel: 'Primary',
    }),
  };
  issueRecords.set(issueKey, record);
  return record;
}

export function AvatarKeyCardScreen({
  guestName,
  issueKey,
  onReceived,
  roomNumber,
}: Props) {
  const [phase, setPhase] = useState<Phase>('dispensing');
  const [statusText, setStatusText] = useState(
    'Preparing the dispenser and writing your room key...'
  );
  const onReceivedRef = useRef(onReceived);
  const hasReservationDetails = Boolean(guestName && roomNumber);
  const visiblePhase = hasReservationDetails ? phase : 'error';
  const visibleStatusText = hasReservationDetails
    ? statusText
    : 'Reservation details are needed before issuing a room key.';

  useEffect(() => {
    onReceivedRef.current = onReceived;
  }, [onReceived]);

  useEffect(() => {
    enableSuccessSoundOnNextGesture();
  }, []);

  useEffect(() => {
    let active = true;

    if (!guestName || !roomNumber) {
      return () => {
        active = false;
      };
    }

    const record = getIssueRecord(issueKey, guestName, roomNumber);

    record.promise
      .then((result) => {
        if (!active) return;

        if (!result.success) {
          setStatusText(result.error || 'The key-card encoder could not issue a card.');
          setPhase('error');
          return;
        }

        setStatusText(result.message || 'Your key card is ready.');
        setPhase('done');

        if (!notifiedIssueKeys.has(issueKey)) {
          notifiedIssueKeys.add(issueKey);
          playSuccessSound();
          onReceivedRef.current();
        }
      })
      .catch(() => {
        if (!active) return;
        setStatusText('The key-card encoder is not reachable. Please ask the concierge for help.');
        setPhase('error');
      });

    return () => {
      active = false;
    };
  }, [guestName, issueKey, roomNumber]);

  const completeKeyCard = () => {
    if (phase === 'done') return;
    playSuccessSound();
    setPhase('done');

    if (!notifiedIssueKeys.has(issueKey)) {
      notifiedIssueKeys.add(issueKey);
      onReceivedRef.current();
    }
  };

  return (
    <div className="flex h-full flex-col justify-center gap-4 text-center">
      <h3 className="text-lg text-[var(--color-hotel-accent)]">Your key card</h3>
      {(visiblePhase === 'encoding' || visiblePhase === 'dispensing') && (
        <p className="text-sm text-[var(--color-hotel-text-dim)]">
          The drawer will extend when encoding finishes.
        </p>
      )}
      {visiblePhase === 'done' && (
        <p className="text-sm text-[var(--color-hotel-text-dim)]">{visibleStatusText}</p>
      )}
      {visiblePhase === 'error' && (
        <p className="text-sm text-red-200">{visibleStatusText}</p>
      )}
      <button
        type="button"
        className="w-full rounded-lg bg-[var(--color-hotel-accent)] py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={visiblePhase === 'encoding' || visiblePhase === 'dispensing'}
        onClick={completeKeyCard}
      >
        I have my key card
      </button>
    </div>
  );
}
