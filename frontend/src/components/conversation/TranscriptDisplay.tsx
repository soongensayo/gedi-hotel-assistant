import { useEffect, useRef } from 'react';
import { useConversationStore } from '../../stores/conversationStore';

export function TranscriptDisplay() {
  const { messages, isLoading } = useConversationStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Only show last few messages to keep it compact
  const recentMessages = messages.filter((m) => m.role !== 'system').slice(-6);

  if (recentMessages.length === 0 && !isLoading) return null;

  return (
    <div
      ref={scrollRef}
      className="flex flex-col gap-3 max-h-48 overflow-y-auto px-2 py-1"
    >
      {recentMessages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`
              max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed
              ${msg.role === 'user'
                ? 'bg-hotel-accent/15 text-hotel-text rounded-br-md'
                : 'bg-white/5 text-hotel-text rounded-bl-md'
              }
            `}
          >
            {msg.content}
          </div>
        </div>
      ))}

      {/* Typing indicator */}
      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-white/5 px-4 py-3 rounded-2xl rounded-bl-md flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-hotel-accent/40 animate-bounce [animation-delay:0ms]" />
            <div className="w-2 h-2 rounded-full bg-hotel-accent/40 animate-bounce [animation-delay:150ms]" />
            <div className="w-2 h-2 rounded-full bg-hotel-accent/40 animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </div>
  );
}
