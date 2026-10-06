'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';

interface RoundSummaryMessage {
  id: string;
  modelId?: string;
  authorName?: string;
  content: string;
}

interface RoundSummaryControlProps {
  discussionId?: string | null;
  roundId: string;
  contextPrompt?: string;
  messages: RoundSummaryMessage[];
}

function RoundSummaryIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M4.25 5.25h7M4.25 9.25h5.25M4.25 13.25h7"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="M14.15 7.2v5.55m0 0-2.05-2.05m2.05 2.05 2.05-2.05"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const RoundSummaryControl: React.FC<RoundSummaryControlProps> = ({
  discussionId,
  roundId,
  contextPrompt = '',
  messages,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const cacheKey = useMemo(() => {
    const messageKey = messages.map((message) => message.id).join(':');
    return `plurilog:round-summary:${discussionId || 'local'}:${roundId}:${messageKey}`;
  }, [discussionId, messages, roundId]);

  useEffect(() => {
    setSummary('');
    setError('');
    setCopied(false);

    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) setSummary(cached);
    } catch {
      // Caching is a convenience only.
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const requestSummary = async () => {
    if (isLoading || summary) return;

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/round-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          discussionId: discussionId || undefined,
          contextPrompt,
          messages: messages.map((message) => ({
            id: message.id,
            modelId: message.modelId,
            authorName: message.authorName,
            content: message.content,
          })),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      const nextSummary =
        typeof payload?.summary === 'string' ? payload.summary.trim() : '';

      if (!response.ok || !nextSummary) {
        throw new Error(
          typeof payload?.error === 'string'
            ? payload.error
            : 'Could not summarize this round.'
        );
      }

      setSummary(nextSummary);

      try {
        window.localStorage.setItem(cacheKey, nextSummary);
      } catch {
        // Reopening in this session still uses React state.
      }
    } catch (requestError: any) {
      setError(
        requestError?.message || 'Could not summarize this round.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const roomBelow = window.innerHeight - rect.bottom;
      setOpenUp(roomBelow < 245 && rect.top > 270);
    } else {
      setOpenUp(false);
    }

    setIsOpen(true);

    if (!summary) {
      void requestSummary();
    }
  };

  const handleCopy = async () => {
    if (!summary) return;

    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard failure should not affect the summary UI.
    }
  };

  const summaryItems = summary
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/u, '').trim())
    .filter(Boolean);

  return (
    <div
      ref={wrapperRef}
      className="relative z-[70]"
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`flex h-8 w-8 items-center justify-center rounded-full border bg-white shadow-[0_1px_5px_rgba(28,27,26,0.05)] transition-all duration-150 cursor-pointer ${isOpen ? 'border-[#CFCBC2] text-[#1C1B1A] bg-[#F7F6F3]' : 'border-[#D9D6CF] text-[#6A675F] hover:border-[#CFCBC2] hover:text-[#1C1B1A] hover:bg-white'}`}
        title="Summarize this round"
        aria-label="Summarize this round"
        aria-expanded={isOpen}
      >
        <RoundSummaryIcon className="h-[15px] w-[15px]" />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Round summary"
          className={`absolute right-0 z-[80] w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-[16px] border border-[#D9D6CF] bg-white shadow-[0_18px_48px_rgba(28,27,26,0.14)] sm:w-[350px] ${openUp ? 'bottom-10' : 'top-10'}`}
        >
          <div className="flex h-11 items-center gap-2 border-b border-[#ECEAE5] px-3.5">
            <RoundSummaryIcon className="h-4 w-4 shrink-0 text-[#6A675F]" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#3A3936]">
              Round summary
            </span>

            {summary && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[#8A867D] transition-colors hover:bg-[#F1F0ED] hover:text-[#1C1B1A]"
                title={copied ? 'Copied' : 'Copy summary'}
                aria-label={copied ? 'Copied' : 'Copy summary'}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[#8A867D] transition-colors hover:bg-[#F1F0ED] hover:text-[#1C1B1A]"
              title="Close"
              aria-label="Close round summary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-[min(46vh,300px)] overflow-y-auto px-4 py-3.5">
            {isLoading ? (
              <div className="flex min-h-[54px] items-center gap-2 text-[12px] text-[#8A867D]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Summarizing…</span>
              </div>
            ) : error ? (
              <div className="flex min-h-[54px] items-center justify-between gap-3">
                <span className="text-[12px] leading-5 text-[#8A675F]">
                  {error}
                </span>
                <button
                  type="button"
                  onClick={() => void requestSummary()}
                  className="shrink-0 rounded-md border border-[#D9D6CF] px-2.5 py-1.5 text-[11px] font-medium text-[#3A3936] hover:bg-[#F7F6F3]"
                >
                  Retry
                </button>
              </div>
            ) : summaryItems.length > 0 ? (
              <div className="space-y-2.5">
                {summaryItems.map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="flex items-start gap-2.5 text-[12.5px] leading-[1.55] text-[#3A3936]"
                  >
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#6A675F]" />
                    <span className="min-w-0">{item}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="min-h-[54px]" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
