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

  // Only show last 3 messages to keep it compact
  const recentMessages = messages.filter((m) => m.role !== 'system').slice(-3);

  if (recentMessages.length === 0 && !isLoading) return null;

  return (
    <div
      ref={scrollRef}
      className="flex flex-col gap-1.5 max-h-24 overflow-y-auto px-1"
    >
      {recentMessages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`
              max-w-[80%] px-3 py-1.5 rounded-xl text-xs leading-relaxed
              ${msg.role === 'user'
                ? 'bg-hotel-accent/15 text-hotel-text rounded-br-sm'
                : 'bg-white/5 text-hotel-text rounded-bl-sm'
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
          <div className="bg-white/5 px-3 py-2 rounded-xl rounded-bl-sm flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-hotel-accent/40 animate-bounce [animation-delay:0ms]" />
            <div className="w-1.5 h-1.5 rounded-full bg-hotel-accent/40 animate-bounce [animation-delay:150ms]" />
            <div className="w-1.5 h-1.5 rounded-full bg-hotel-accent/40 animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </div>
  );
}
