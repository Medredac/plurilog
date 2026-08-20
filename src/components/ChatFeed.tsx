'use client';

import React, { useState } from 'react';
import { 
  ThumbsUp, 
  Copy, 
  Check, 
  AlertCircle
} from 'lucide-react';
import { ChatMessage, ModelId, SeatStatus } from '../types/chat';
import { COUNCIL_MEMBERS } from '../data/mockDebates';

interface ChatFeedProps {
  messages: ChatMessage[];
  onPromptClick: (prompt: string) => void;
  activeSpeaker?: ModelId | null;
  seatStatuses?: Record<ModelId, SeatStatus>;
  isDebating?: boolean;
  errorMessage?: string | null;
}

export const ChatFeed: React.FC<ChatFeedProps> = ({
  messages,
  onPromptClick,
  activeSpeaker = null,
  seatStatuses = {
    'gemini': 'idle',
    'claude': 'idle',
    'chatgpt': 'idle',
  },
  isDebating = false,
  errorMessage = null,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Record<string, number>>({});

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleLike = (id: string, currentLikes: number = 0) => {
    setLikedIds((prev) => ({
      ...prev,
      [id]: (prev[id] ?? currentLikes) + 1,
    }));
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-4 max-w-3xl mx-auto w-full">
      {/* Error Notice */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200/80 text-red-800 text-xs flex items-start gap-2.5 shadow-2xs">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">Notice</span>
            <p className="leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      {messages.map((message) => {
        // User Message Bubble (Soft minimalist warm stone-100 tone)
        if (message.role === 'user') {
          return (
            <div key={message.id} className="flex justify-end pt-1">
              <div className="max-w-2xl bg-stone-100 border border-stone-200/90 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between gap-4 mb-1 text-xs text-stone-500">
                  <span className="font-semibold text-stone-900">{message.authorName || 'You'}</span>
                  <span className="text-[10px] font-mono text-stone-400">{message.timestamp}</span>
                </div>
                <p className="text-sm font-normal text-stone-900 leading-relaxed whitespace-pre-line">
                  {message.content}
                </p>
              </div>
            </div>
          );
        }

        // Sequential AI Model Card
        let modelKey: ModelId = 'gemini';
        if (message.modelId) {
          const lower = String(message.modelId).toLowerCase();
          if (lower.includes('claude') || lower.includes('anthropic')) modelKey = 'claude';
          else if (lower.includes('chatgpt') || lower.includes('gpt') || lower.includes('openai')) modelKey = 'chatgpt';
          else modelKey = 'gemini';
        }

        const member = COUNCIL_MEMBERS[modelKey] || {
          id: modelKey,
          apiModelId: message.modelId || '',
          name: message.authorName || 'AI',
          shortName: message.authorName || 'AI',
          statusDotColor: 'bg-zinc-500',
          status: 'Ready',
        };

        const currentLikes = likedIds[message.id] ?? (message.likes || 0);

        return (
          <div
            key={message.id}
            className="rounded-xl border border-zinc-100 bg-white p-4 sm:p-5 shadow-sm transition-all hover:border-zinc-200"
          >
            {/* Header: Model name & timestamp only */}
            <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${member.statusDotColor}`} />
                <span className="font-semibold text-xs text-zinc-900">
                  {member.name}
                </span>
              </div>

              <span className="text-[10px] font-mono text-zinc-400">
                {message.timestamp}
              </span>
            </div>

            {/* Message Body */}
            <div className="text-xs sm:text-sm text-zinc-800 leading-relaxed font-normal space-y-2 whitespace-pre-line">
              {message.content}
              {message.isStreaming && (
                <span className="inline-block w-1.5 h-3.5 bg-amber-500 animate-pulse ml-0.5 align-middle" />
              )}
            </div>

            {/* Bottom Actions Bar */}
            <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleLike(message.id, message.likes)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
                  title="Like"
                >
                  <ThumbsUp className="w-3 h-3" />
                  <span className="font-mono text-[10px]">{currentLikes}</span>
                </button>

                <button
                  onClick={() => handleCopy(message.id, message.content)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
                  title="Copy text"
                >
                  {copiedId === message.id ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span className="text-[10px] text-emerald-600 font-medium">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span className="text-[10px]">Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
