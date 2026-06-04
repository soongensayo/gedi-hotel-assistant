import { useCallback, useState } from 'react';
import { useStanfordVoiceInput } from './useStanfordVoiceInput';

export type AvatarMessage = {
  id: string;
  role: 'guest' | 'avatar';
  content: string;
};

type Props = {
  messages: AvatarMessage[];
  busy: boolean;
  speaking: boolean;
  onSend: (message: string) => Promise<void>;
  onInterrupt: () => void;
};

export function StanfordAvatarChatPanel({
  messages,
  busy,
  speaking,
  onSend,
  onInterrupt,
}: Props) {
  const [text, setText] = useState('');
  const {
    isListening,
    isRecording,
    isProcessing,
    audioLevel,
    startListening,
    stopListening,
  } = useStanfordVoiceInput({
    busy,
    speaking,
    onTranscript: (transcript) => {
      void onSend(transcript);
    },
    onInterrupt,
  });

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const clean = text.trim();
      if (!clean || busy) return;
      setText('');
      await onSend(clean);
    },
    [busy, onSend, text]
  );

  return (
    <div className="border-t border-[var(--color-hotel-border)] bg-[var(--guest-deep)]/90 px-4 py-3 text-white shadow-[0_-18px_48px_rgba(0,0,0,0.22)] backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-end gap-3">
        <div className="min-h-[58px] flex-1 overflow-hidden">
          <div className="flex max-h-20 flex-col gap-1 overflow-y-auto pr-2">
            {messages.slice(-3).map((message) => (
              <p
                key={message.id}
                className={`text-sm leading-5 ${
                  message.role === 'avatar' ? 'text-white/86' : 'text-[var(--color-hotel-gold)]'
                }`}
              >
                <span className="mr-2 text-[10px] uppercase tracking-widest text-white/42">
                  {message.role === 'avatar' ? 'Azure' : 'Guest'}
                </span>
                {message.content}
              </p>
            ))}
            {busy && (
              <p className="text-sm leading-5 text-white/52">
                <span className="mr-2 text-[10px] uppercase tracking-widest text-white/42">
                  Azure
                </span>
                One moment please...
              </p>
            )}
          </div>
          <form onSubmit={submit} className="mt-2 flex gap-2">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
              placeholder="Type or tap the microphone..."
              className="min-w-0 flex-1 rounded-lg border border-white/14 bg-white/8 px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--color-hotel-gold)]/60 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="rounded-lg border border-[var(--color-hotel-gold)]/45 bg-[var(--color-hotel-gold)]/16 px-4 py-2 text-sm font-medium text-[#f8f1df] transition hover:bg-[var(--color-hotel-gold)]/22 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Send
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={() => {
            if (isListening) stopListening();
            else void startListening();
          }}
          disabled={(busy || isProcessing) && !isListening}
          className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition ${
            isRecording
              ? 'border-red-300/70 bg-red-500/18 text-red-100'
              : isListening
                ? 'border-[var(--color-hotel-gold)]/70 bg-[var(--color-hotel-gold)]/18 text-[#f8f1df]'
                : 'border-white/18 bg-white/8 text-white/72 hover:border-[var(--color-hotel-gold)]/55'
          } disabled:cursor-not-allowed disabled:opacity-45`}
          title={isListening ? 'Stop voice mode' : 'Start voice mode'}
        >
          {isListening && (
            <span
              className="absolute inset-[-4px] rounded-full border border-[var(--color-hotel-gold)]/24"
              style={{ transform: `scale(${1 + audioLevel * 0.32})` }}
            />
          )}
          {isProcessing ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
