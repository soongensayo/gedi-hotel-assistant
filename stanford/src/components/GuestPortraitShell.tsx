import type { ReactNode } from 'react';
import { GuestShowcasePanel } from './GuestShowcasePanel';

type Props = {
  children: ReactNode;
  showcaseOverlay?: ReactNode;
  topClassName?: string;
};

export function GuestPortraitShell({
  children,
  showcaseOverlay,
  topClassName = '',
}: Props) {
  return (
    <div className="guest-portrait-shell relative flex h-full w-full flex-col overflow-hidden bg-[var(--color-hotel-dark)]">
      <div className={`relative min-h-0 flex-1 overflow-hidden ${topClassName}`}>
        {children}
      </div>
      <div className="relative shrink-0 overflow-hidden">
        <GuestShowcasePanel />
      </div>
      {showcaseOverlay}
    </div>
  );
}
