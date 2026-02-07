import type { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  title?: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal content */}
      <div className="relative glass-panel p-8 max-w-lg w-full mx-4 shadow-[0_0_40px_rgba(0,212,255,0.15)]">
        {title && (
          <h2 className="text-xl font-semibold text-hotel-accent mb-4">{title}</h2>
        )}
        {children}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-hotel-text-dim hover:text-hotel-text transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
