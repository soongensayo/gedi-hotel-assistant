import type { ReactNode } from 'react';
import { GuestShowcasePanel } from './GuestShowcasePanel';

type Props = {
  children: ReactNode;
  topClassName?: string;
};

export function GuestPortraitShell({ children, topClassName = '' }: Props) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--color-hotel-dark)]">
      <div className={`relative min-h-0 flex-1 overflow-hidden ${topClassName}`}>
        {children}
      </div>
      <GuestShowcasePanel />
    </div>
  );
}
