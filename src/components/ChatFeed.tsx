'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  ThumbsUp, 
  Copy, 
  Check, 
  AlertCircle,
  CornerDownRight,
  ChevronDown,
  ChevronUp
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
  canContinue?: boolean;
  onContinue?: () => void;
  activeDebateId?: string | null;
  isNewlyCreatedRef?: React.MutableRefObject<boolean>;
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
  canContinue = false,
  onContinue,
  activeDebateId = null,
  isNewlyCreatedRef,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastActiveDebateIdRef = useRef<string | null>(null);
  const lastUserMsgIdRef = useRef<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Record<string, number>>({});
  const [expandedMsgIds, setExpandedMsgIds] = useState<Record<string, boolean>>({});

  // 1. When switching or loading a discussion from sidebar: scroll directly to the bottom (completed history)
  useEffect(() => {
    if (activeDebateId && activeDebateId !== lastActiveDebateIdRef.current) {
      lastActiveDebateIdRef.current = activeDebateId;

      // If discussion was just auto-created by sending a prompt, skip jump-to-bottom
      if (isNewlyCreatedRef?.current) {
        isNewlyCreatedRef.current = false;
        return;
      }

      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
      }, 50);
    }
  }, [activeDebateId, isNewlyCreatedRef]);

  // 2. On sending a new message or inserting Continue bubble: scroll smoothly so message sits near top of viewport, then hold still
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user' && lastMsg.id !== lastUserMsgIdRef.current) {
      lastUserMsgIdRef.current = lastMsg.id;
      requestAnimationFrame(() => {
        const el = document.getElementById(lastMsg.id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
  }, [messages]);

  const toggleExpand = (id: string) => {
    setExpandedMsgIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

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
    <div className="px-4 sm:px-8 pt-6 pb-6 max-w-5xl mx-auto w-full flex flex-col">
      {/* Error Notice */}
      {errorMessage && (
        <div className="p-3.5 mb-5 rounded-xl bg-red-50 border border-red-200/80 text-red-800 text-xs flex items-start gap-2.5 shadow-2xs">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">Notice</span>
            <p className="leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      {messages.map((message, idx) => {
        const isPrevUser = idx > 0 && messages[idx - 1]?.role === 'user';

        // User Message Bubble (Soft minimalist warm stone-100 tone)
        if (message.role === 'user') {
          const isLongContent = message.content.length > 240 || message.content.split('\n').length > 4;
          const isExpanded = !!expandedMsgIds[message.id];

          return (
            <div 
              id={message.id}
              key={message.id} 
              className={`flex justify-end scroll-mt-6 sm:scroll-mt-8 ${idx === 0 ? 'mt-0' : 'mt-10 sm:mt-12'}`}
            >
              <div className="max-w-3xl bg-stone-100 border border-stone-200/90 rounded-xl p-4.5 shadow-sm relative">
                <div className="flex items-center justify-between gap-4 mb-1.5 text-xs text-stone-500">
                  <span className="font-semibold text-stone-900">{message.authorName || 'You'}</span>
                  <span className="text-[10px] font-mono text-stone-400">{message.timestamp}</span>
                </div>

                {/* Message Body with truncation if long */}
                <div className="relative">
                  <p
                    className={`text-base font-normal text-stone-900 leading-relaxed whitespace-pre-line ${
                      isLongContent && !isExpanded ? 'line-clamp-4 max-h-28 overflow-hidden' : ''
                    }`}
                  >
                    {message.content}
                  </p>

                  {/* Show More / Show Less Toggle */}
                  {isLongContent && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(message.id)}
                      className="w-full mt-2 pt-1.5 flex items-center justify-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900 transition-colors border-t border-stone-200/60 cursor-pointer"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="w-3.5 h-3.5" />
                          <span>Show less</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>Show more</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
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

        // Gap calculation:
        // - Larger noticeable gap following a user message (User -> Model)
        // - Smaller cohesive gap following another model response (Model -> Model)
        const spacingClass = idx === 0 
          ? 'mt-0' 
          : isPrevUser 
            ? 'mt-7 sm:mt-8' 
            : 'mt-3.5 sm:mt-4';

        return (
          <div
            id={message.id}
            key={message.id}
            className={`rounded-xl border border-zinc-100 bg-white p-5 sm:p-6 shadow-sm transition-all hover:border-zinc-200 scroll-mt-6 sm:scroll-mt-8 ${spacingClass}`}
          >
            {/* Header: Model name & timestamp only */}
            <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-zinc-100">
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
            <div className="text-base sm:text-[16.5px] text-zinc-800 leading-relaxed font-normal space-y-2.5 whitespace-pre-line">
              {message.content}
              {message.isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-amber-500 animate-pulse ml-0.5 align-middle" />
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

      {/* Continue Discussion Button - Fades in below final message bubble, bottom-right */}
      {canContinue && !isDebating && messages.length > 0 && onContinue && (
        <div className="flex justify-end pt-3 animate-in fade-in zoom-in-95 duration-200">
          <button
            type="button"
            onClick={onContinue}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-amber-50/80 border border-zinc-200/80 hover:border-amber-200/90 text-zinc-700 hover:text-zinc-900 text-xs font-medium shadow-2xs hover:shadow-xs transition-all cursor-pointer group"
            title="Trigger another deliberation round on this topic"
          >
            <CornerDownRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-amber-800 transition-colors" />
            <span>Continue</span>
          </button>
        </div>
      )}

      {/* Dynamic bottom spacer: untransitioned/instant height change so scrollHeight is immediately accurate during deliberation */}
      <div className={`w-full shrink-0 ${isDebating ? 'h-[50vh]' : 'h-0'}`} />

      {/* Invisible anchor for auto-scroll on discussion load */}
      <div ref={bottomRef} className="h-1 w-full" />
    </div>
  );
};
