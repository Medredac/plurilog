'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { 
  Copy, 
  Check, 
  AlertCircle, 
  CornerDownRight, 
  ChevronDown, 
  ChevronUp,
  FileText,
  Download
} from 'lucide-react';
import { ChatMessage, ModelId, SeatStatus } from '../types/chat';
import { COUNCIL_MEMBERS } from '../data/mockDebates';
import { ImageLightbox } from './ImageLightbox';
import { isTextFileUrl, isTextFileName, getTextFileDisplayBadge } from '@/utils/textFileParser';
import { isImageUrl } from '@/utils/discussionMemory';

const conversationDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function getLocalDayKey(dateInput?: string): string {
  if (!dateInput) return '';

  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function formatConversationDate(dateInput?: string): string {
  if (!dateInput) return '';

  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';

  return conversationDateFormatter.format(d);
}

// Safe extraction of clean display filename from stored/signed attachment URL or optimistic blob URL
export function getAttachmentDisplayFilename(url?: string | null): string {
  if (!url || typeof url !== 'string') return 'attachment';

  // A. Check fragment for explicit filename (e.g. optimistic blob URLs with #filename=...)
  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    const hashPart = url.slice(hashIndex + 1);
    const filenameParam = hashPart.startsWith('filename=')
      ? hashPart.slice(9)
      : hashPart.startsWith('name=')
        ? hashPart.slice(5)
        : hashPart;
    if (filenameParam) {
      try {
        const decoded = decodeURIComponent(filenameParam).trim();
        if (decoded) return decoded;
      } catch {
        // ignore decoding failure and fallback
      }
    }
  }

  // B. Strip query string and fragment
  const cleanUrl = url.split('?')[0].split('#')[0];
  const isPdf = cleanUrl.toLowerCase().endsWith('.pdf');
  const isDocx = cleanUrl.toLowerCase().endsWith('.docx');
  const isText = isTextFileUrl(cleanUrl);
  const defaultFallback = isPdf
    ? 'document.pdf'
    : isDocx
      ? 'document.docx'
      : isText
        ? 'document.txt'
        : 'attachment';

  // C. Take final path segment
  const segments = cleanUrl.split('/');
  const rawSegment = segments.pop() || '';
  if (!rawSegment) return defaultFallback;

  // D. Decode safely (handle malformed percent encoding gracefully)
  let decodedSegment = rawSegment;
  try {
    decodedSegment = decodeURIComponent(rawSegment);
  } catch {
    decodedSegment = rawSegment;
  }

  // E. If it matches Plurilog's generated upload prefix:
  // e.g. "1725555555555-0-abcde-IMG_1402.JPG" -> "IMG_1402.JPG"
  // Prefix pattern: ^\d{10,14}-\d+-[a-zA-Z0-9]+-(.+)
  const prefixMatch = decodedSegment.match(/^\d{10,14}-\d+-[a-zA-Z0-9]+-(.+)$/);
  if (prefixMatch && prefixMatch[1]) {
    return prefixMatch[1].trim() || defaultFallback;
  }

  const altPrefixMatch = decodedSegment.match(/^\d+-\d+-[a-zA-Z0-9]{3,10}-(.+)$/);
  if (altPrefixMatch && altPrefixMatch[1]) {
    return altPrefixMatch[1].trim() || defaultFallback;
  }

  // F. If it is an opaque blob URL without an extension, fallback to defaultFallback
  const trimmed = decodedSegment.trim();
  if (cleanUrl.startsWith('blob:') && !trimmed.includes('.')) {
    return defaultFallback;
  }

  // G. Otherwise preserve the basename unchanged
  return trimmed || defaultFallback;
}

interface ParsedSource {
  title: string;
  url: string;
}

interface ParsedMessageSources {
  mainContent: string;
  sources: ParsedSource[] | null;
}

// Display-only helper to recognize Plurilog-generated trailing Sources block
function parseTrailingSources(rawContent: string): ParsedMessageSources {
  if (!rawContent || typeof rawContent !== 'string') {
    return { mainContent: rawContent || '', sources: null };
  }

  const marker = '\n\nSources:\n';
  const lastIndex = rawContent.lastIndexOf(marker);
  if (lastIndex === -1) {
    return { mainContent: rawContent, sources: null };
  }

  const potentialMain = rawContent.slice(0, lastIndex);
  const potentialSourcesBlock = rawContent.slice(lastIndex + marker.length).trim();

  const lines = potentialSourcesBlock.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { mainContent: rawContent, sources: null };
  }

  const parsedSources: ParsedSource[] = [];
  const itemRegex = /^-\s*\[(.+)\]\((https?:\/\/[^\s\)]+)\)$/;

  for (const line of lines) {
    const itemMatch = itemRegex.exec(line);
    if (!itemMatch) {
      return { mainContent: rawContent, sources: null };
    }
    const cleanTitle = itemMatch[1].replace(/\\([\[\]\\])/g, '$1').trim();
    parsedSources.push({
      title: cleanTitle || 'Source',
      url: itemMatch[2].trim(),
    });
  }

  return {
    mainContent: potentialMain,
    sources: parsedSources,
  };
}

// Custom Fenced Code Block Component: Beige header with copy button, neutral syntax-highlighted code area
const CodeBlock: React.FC<{ children?: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';
  const codeContent = String(children || '').replace(/\n$/, '');

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(codeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-3 rounded-xl border border-zinc-200/80 bg-[#f8f8f8] overflow-hidden shadow-2xs group text-left w-full max-w-full min-w-0">
      {/* Top Header Bar with Language tag and Copy Button (Neutral light grey styling) */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#f4f4f4] border-b border-zinc-200/70 text-zinc-500 min-w-0">
        <span className="text-[11px] font-mono font-medium lowercase tracking-wide text-zinc-500 truncate">
          {language !== 'text' ? language : 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 sm:py-0.5 rounded-md text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200/70 active:bg-zinc-300/60 transition-colors cursor-pointer shrink-0"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-[10px] font-mono text-emerald-600 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Syntax Highlighted Code Area (Cohesive Soft Light Grey Background #f8f8f8) */}
      <div className="overflow-x-auto bg-[#f8f8f8] max-w-full">
        <SyntaxHighlighter
          language={language}
          style={oneLight}
          customStyle={{
            margin: 0,
            padding: '0.875rem 1rem',
            backgroundColor: '#f8f8f8',
            fontSize: '0.8125rem',
            lineHeight: '1.6',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'inherit',
            },
          }}
        >
          {codeContent}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

const markdownComponents: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    const isFenced = Boolean(match) || String(children).includes('\n');

    if (!isFenced) {
      return (
        <code
          className="font-mono text-[0.875em] bg-zinc-100 text-zinc-800 px-1.5 py-0.5 rounded-md border border-zinc-200/60 font-normal break-words [overflow-wrap:anywhere]"
          {...props}
        >
          {children}
        </code>
      );
    }

    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  p: ({ children }) => (
    <p className="text-base sm:text-[16.5px] text-zinc-800 leading-relaxed font-normal mb-3 last:mb-0 break-words [overflow-wrap:anywhere]">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-2.5 pl-5 list-disc space-y-1 text-zinc-800 text-base sm:text-[16.5px] break-words">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 pl-5 list-decimal space-y-1 text-zinc-800 text-base sm:text-[16.5px] break-words">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed text-zinc-800 text-base sm:text-[16.5px] break-words">
      {children}
    </li>
  ),
  h1: ({ children }) => (
    <h1 className="font-semibold text-lg sm:text-xl text-zinc-900 mt-4 mb-2 break-words">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-semibold text-base sm:text-lg text-zinc-900 mt-3.5 mb-1.5 break-words">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-semibold text-sm sm:text-base text-zinc-900 mt-3 mb-1 break-words">
      {children}
    </h3>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-zinc-900">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-amber-300 pl-3.5 my-2.5 italic text-zinc-600 break-words">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-amber-800 hover:text-amber-900 underline underline-offset-2 transition-colors break-words [overflow-wrap:anywhere]"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="w-full max-w-full overflow-x-auto my-3 rounded-lg border border-zinc-200/80">
      <table className="min-w-full text-left text-xs sm:text-sm divide-y divide-zinc-200 border-collapse">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-zinc-50/90 text-zinc-700 font-semibold">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-zinc-100 bg-white text-zinc-800">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-zinc-50/50 transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-xs font-semibold text-zinc-900 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-xs text-zinc-700 break-words max-w-xs">
      {children}
    </td>
  ),
};

export interface FailedTurnState {
  uiMessageId: string;
  sourceUserMessageId: string;
  discussionId: string;
  prompt: string;
  attachments: { url: string; filename: string }[] | null;
  seatOrder: ModelId[];
}

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
  failedTurn?: FailedTurnState | null;
  onRetryTurn?: (failedTurn: FailedTurnState) => void;
  abandonedFailedTurnIds?: string[];
  onExportMessage?: (message: ChatMessage) => void;
  newlySentUserMessageId?: string | null;
  onNewlySentAnimationComplete?: () => void;
}

/**
 * Presentation-only hook that smoothly and progressively reveals newly arriving text chunks.
 * Throttles React re-renders to ~25-40ms (approx 25-40 FPS) with adaptive catch-up stepping.
 * Immediately returns full authoritative text when not streaming or when completed.
 */
function useSmoothReveal(targetText: string, isStreaming?: boolean): string {
  // Initial state: If mounted with existing content (e.g. user navigating back to active generation),
  // start directly at current targetText.length so we do NOT replay from 0!
  const [displayedLength, setDisplayedLength] = useState(() => targetText.length);

  const targetLengthRef = useRef(targetText.length);
  targetLengthRef.current = targetText.length;

  const displayedLengthRef = useRef(displayedLength);
  displayedLengthRef.current = displayedLength;

  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  useEffect(() => {
    // If target text shrunk (e.g. reset/retry), snap immediately
    if (displayedLengthRef.current > targetText.length) {
      setDisplayedLength(targetText.length);
      displayedLengthRef.current = targetText.length;
      return;
    }

    if (!isStreaming) {
      setDisplayedLength(targetText.length);
      displayedLengthRef.current = targetText.length;
      return;
    }

    let rafId: number | null = null;
    let lastTime = 0;

    const tick = (now: number) => {
      if (!isStreamingRef.current) {
        setDisplayedLength(targetLengthRef.current);
        displayedLengthRef.current = targetLengthRef.current;
        return;
      }

      const current = displayedLengthRef.current;
      const target = targetLengthRef.current;

      if (current >= target) {
        // Up to date; wait for new text without scheduling unnecessary renders
        rafId = null;
        return;
      }

      // Throttle visible state updates to ~28ms (approx 35 FPS) to keep Markdown rendering smooth
      if (now - lastTime >= 28) {
        lastTime = now;
        const lag = target - current;

        let step = 1;
        if (lag <= 8) {
          step = 1; // silky smooth typing pace for small lag
        } else if (lag <= 25) {
          step = 2; // steady reading pace
        } else if (lag <= 60) {
          step = 4; // brisk catch-up
        } else if (lag <= 120) {
          step = 8; // aggressive catch-up
        } else {
          step = Math.ceil(lag / 4); // rapid catch-up for massive burst arrivals
        }

        const nextLen = Math.min(target, current + step);
        displayedLengthRef.current = nextLen;
        setDisplayedLength(nextLen);
      }

      rafId = requestAnimationFrame(tick);
    };

    // If there is lag to reveal, start or continue the RAF loop
    if (displayedLengthRef.current < targetText.length) {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [targetText.length, isStreaming]);

  if (!isStreaming) {
    return targetText;
  }

  return targetText.slice(0, Math.min(displayedLength, targetText.length));
}

interface StreamingMessageBodyProps {
  content: string;
  isStreaming?: boolean;
}

const StreamingMessageBody: React.FC<StreamingMessageBodyProps> = ({ content, isStreaming }) => {
  // Separate trailing Sources footer before visual smoothing so raw Sources markdown is never shown in prose
  const { mainContent, sources } = parseTrailingSources(content);
  const displayedMainContent = useSmoothReveal(mainContent, isStreaming);

  return (
    <div className="space-y-3.5 min-w-0 max-w-full">
      {/* Message Body with real ReactMarkdown rendering */}
      <div className="text-base sm:text-[16.5px] text-zinc-800 leading-relaxed font-normal min-w-0 max-w-full [overflow-wrap:anywhere]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {displayedMainContent}
        </ReactMarkdown>
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-amber-500 animate-pulse ml-0.5 align-middle" />
        )}
      </div>

      {/* Sources Area */}
      {sources && sources.length > 0 && (
        <div className="pt-2.5 border-t border-zinc-100 flex flex-col gap-2 min-w-0 max-w-full">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider select-none">
            Sources
          </span>
          <div className="flex flex-wrap gap-1.5 sm:gap-2 max-w-full min-w-0">
            {sources.map((source, i) => (
              <a
                key={`${source.url}-${i}`}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-50 hover:bg-zinc-100 active:bg-zinc-200/70 border border-zinc-200/80 text-zinc-700 hover:text-zinc-900 text-xs font-medium transition-colors group cursor-pointer max-w-full min-w-0"
                title={source.title}
              >
                <span className="truncate max-w-[170px] sm:max-w-[300px]">
                  {source.title}
                </span>
                <span className="text-zinc-400 group-hover:text-zinc-600 shrink-0 text-[11px] select-none">
                  ↗
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

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
  failedTurn = null,
  onRetryTurn,
  abandonedFailedTurnIds = [],
  onExportMessage,
  newlySentUserMessageId = null,
  onNewlySentAnimationComplete,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastActiveDebateIdRef = useRef<string | null>(null);
  const lastUserMsgIdRef = useRef<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedMsgIds, setExpandedMsgIds] = useState<Record<string, boolean>>({});
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);

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
    const prevMsg = messages.length > 1 ? messages[messages.length - 2] : null;

    let candidate: ChatMessage | null = null;
    if (lastMsg && lastMsg.role === 'user') {
      candidate = lastMsg;
    } else if (
      lastMsg &&
      lastMsg.role === 'model' &&
      lastMsg.isStreaming &&
      !lastMsg.content &&
      prevMsg &&
      prevMsg.role === 'user'
    ) {
      candidate = prevMsg;
    }

    if (candidate && candidate.id !== lastUserMsgIdRef.current) {
      lastUserMsgIdRef.current = candidate.id;
      requestAnimationFrame(() => {
        const el = document.getElementById(candidate.id);
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

  return (
    <div className="pl-[max(clamp(0.75rem,calc(2vw_+_0.25rem),2rem),env(safe-area-inset-left))] pr-[max(clamp(0.75rem,calc(2vw_+_0.25rem),2rem),env(safe-area-inset-right))] pt-4 sm:pt-6 pb-6 max-w-5xl mx-auto w-full flex flex-col min-w-0">
      {/* Error Notice (Non-turn errors, e.g. upload/storage issues) */}
      {errorMessage && (
        <div className="p-3.5 mb-5 rounded-xl bg-red-50 border border-red-200/80 text-red-800 text-xs flex items-start gap-2.5 shadow-2xs min-w-0 max-w-full">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <span className="font-semibold block">Notice</span>
            <p className="leading-relaxed break-words">{errorMessage}</p>
          </div>
        </div>
      )}

      {messages.map((message, idx) => {
        const isPrevUser = idx > 0 && messages[idx - 1]?.role === 'user';
        const prevMessage = idx > 0 ? messages[idx - 1] : null;

        const currentKey = getLocalDayKey(message.createdAt);
        const prevKey = prevMessage
          ? getLocalDayKey(prevMessage.createdAt)
          : '';

        const shouldShowDate =
          Boolean(currentKey) &&
          (idx === 0 || currentKey !== prevKey);

        const formattedDate = formatConversationDate(message.createdAt);

        if (message.role === 'user' && message.content === 'Continue') {
          return (
            <React.Fragment key={message.id}>
              {shouldShowDate && formattedDate && (
                <div
                  className={`flex justify-center select-none ${
                    idx === 0 ? 'mb-4' : 'mt-6 mb-4'
                  }`}
                >
                  <span className="text-xs font-medium text-zinc-400">
                    {formattedDate}
                  </span>
                </div>
              )}
              <div
                id={message.id}
                className={`flex justify-end scroll-mt-6 sm:scroll-mt-8 ${
                  shouldShowDate || idx === 0 ? 'mt-0' : 'mt-10 sm:mt-12'
                }`}
              >
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 text-zinc-400">
                  <CornerDownRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </React.Fragment>
          );
        }

        // User Message Bubble (Soft minimalist warm stone-100 tone)
        if (message.role === 'user') {
          const isLongContent = message.content.length > 240 || message.content.split('\n').length > 4;
          const isExpanded = !!expandedMsgIds[message.id];
          const attachments: string[] =
            message.attachment_urls && message.attachment_urls.length > 0
              ? message.attachment_urls
              : message.image_url
                ? [message.image_url]
                : [];

          return (
            <React.Fragment key={message.id}>
              {shouldShowDate && formattedDate && (
                <div
                  className={`flex justify-center select-none ${
                    idx === 0 ? 'mb-4' : 'mt-6 mb-4'
                  }`}
                >
                  <span className="text-xs font-medium text-zinc-400">
                    {formattedDate}
                  </span>
                </div>
              )}
              <motion.div 
                id={message.id}
                initial={
                  message.id === newlySentUserMessageId
                    ? { opacity: 0, y: shouldReduceMotion ? 0 : 12 }
                    : false
                }
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: shouldReduceMotion ? 0 : 0.16,
                  ease: [0.16, 1, 0.3, 1],
                }}
                onAnimationComplete={() => {
                  if (message.id === newlySentUserMessageId && onNewlySentAnimationComplete) {
                    onNewlySentAnimationComplete();
                  }
                }}
                className={`flex flex-col items-end scroll-mt-6 sm:scroll-mt-8 w-full min-w-0 ${
                  shouldShowDate || idx === 0 ? 'mt-0' : 'mt-10 sm:mt-12'
                }`}
              >
                <div className="max-w-full sm:max-w-3xl w-fit bg-stone-100 rounded-xl p-3.5 sm:p-4.5 shadow-sm relative min-w-0">
                  <div className="flex items-center justify-between gap-4 mb-1.5 text-xs text-stone-500 min-w-0">
                    <span className="font-semibold text-zinc-700 truncate">{message.authorName || 'You'}</span>
                    <span className="text-[10px] font-mono text-stone-400 shrink-0">{message.timestamp}</span>
                  </div>

                  {/* Attached Files (Images or PDFs) if present */}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 sm:gap-2.5 mb-2.5 max-w-full min-w-0">
                      {attachments.map((url, i) => {
                        const filename = getAttachmentDisplayFilename(url);
                        const cleanLower = (url.split('?')[0].split('#')[0] || '').toLowerCase();
                        const fnLower = filename.toLowerCase();

                        const isPdf = cleanLower.endsWith('.pdf') || fnLower.endsWith('.pdf');
                        const isDocx = cleanLower.endsWith('.docx') || fnLower.endsWith('.docx');
                        const isText = isTextFileUrl(cleanLower) || isTextFileName(fnLower);
                        const isImage = isImageUrl(url, filename);

                        return (
                          <div key={`${url}-${i}`} className="flex flex-col items-center gap-1 shrink-0">
                            {isPdf ? (
                              <button
                                type="button"
                                onClick={() => window.open(url, '_blank')}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-1.5 sm:p-2 shrink-0"
                                title={`Click to view ${filename} in new tab`}
                              >
                                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-red-500" />
                                <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1.5 sm:px-2 py-0.5 rounded border border-stone-200/60">
                                  PDF
                                </span>
                              </button>
                            ) : isDocx ? (
                              <button
                                type="button"
                                onClick={() => window.open(url, '_blank')}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-1.5 sm:p-2 shrink-0"
                                title={`Click to download ${filename}`}
                              >
                                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
                                <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1.5 sm:px-2 py-0.5 rounded border border-stone-200/60">
                                  DOCX
                                </span>
                              </button>
                            ) : isText ? (
                              <button
                                type="button"
                                onClick={() => window.open(url, '_blank')}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-1.5 sm:p-2 shrink-0"
                                title={`Click to view ${filename} in new tab`}
                              >
                                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-600" />
                                <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1.5 sm:px-2 py-0.5 rounded border border-stone-200/60">
                                  {getTextFileDisplayBadge(filename)}
                                </span>
                              </button>
                            ) : isImage ? (
                              <button
                                type="button"
                                onClick={() => setLightboxImageUrl(url)}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs block cursor-pointer hover:opacity-90 transition-opacity shrink-0"
                                title={`Click to view ${filename}`}
                              >
                                <img
                                  src={url}
                                  alt={filename}
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => window.open(url, '_blank')}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-1.5 sm:p-2 shrink-0"
                                title={`Click to view ${filename}`}
                              >
                                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-zinc-600" />
                                <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1.5 sm:px-2 py-0.5 rounded border border-stone-200/60">
                                  FILE
                                </span>
                              </button>
                            )}
                            <span
                              className="text-[10px] sm:text-[11px] font-mono text-stone-500 hover:text-stone-700 max-w-[80px] sm:max-w-[112px] truncate px-1 text-center select-all"
                              title={filename}
                            >
                              {filename}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Message Body with truncation if long (only if text exists) */}
                  {message.content?.trim() ? (
                    <div className="relative min-w-0 max-w-full">
                      <p
                        className={`text-base font-normal text-stone-900 leading-relaxed whitespace-pre-line break-words [overflow-wrap:anywhere] ${
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
                          className="w-full mt-2 pt-1.5 flex items-center justify-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900 transition-colors border-t border-stone-200/60 cursor-pointer min-h-[32px] sm:min-h-0"
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
                  ) : null}
                </div>

                {/* Inline Failed Turn State: Active failure (with Try again button) */}
                {failedTurn && failedTurn.uiMessageId === message.id ? (
                  <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 px-3.5 py-2.5 sm:py-2 mt-2.5 rounded-xl bg-stone-100/90 border border-stone-200/90 text-xs text-stone-600 shadow-2xs animate-in fade-in duration-150 max-w-full min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="font-normal text-stone-700 truncate">Something went wrong.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRetryTurn && onRetryTurn(failedTurn)}
                      disabled={isDebating}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-stone-50 active:bg-stone-200/70 border border-stone-200/90 text-stone-800 text-xs font-medium shadow-2xs hover:shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 min-h-[32px] sm:min-h-0 flex items-center"
                    >
                      Try again
                    </button>
                  </div>
                ) : abandonedFailedTurnIds.includes(message.id) ? (
                  /* Muted Abandoned Failure Marker (Session-only, no button) */
                  <div className="flex items-center gap-1.5 px-3 py-1.5 mt-2 rounded-lg text-[11px] text-zinc-400 font-normal select-none animate-in fade-in duration-150">
                    <span>Failed to send</span>
                  </div>
                ) : null}
              </motion.div>
            </React.Fragment>
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

        // Gap calculation:
        // - Larger noticeable gap following a user message (User -> Model)
        // - Smaller cohesive gap following another model response (Model -> Model)
        const spacingClass = shouldShowDate || idx === 0 
          ? 'mt-0' 
          : isPrevUser 
            ? 'mt-7 sm:mt-8' 
            : 'mt-3.5 sm:mt-4';

        const isThinking = message.isStreaming && !message.content.trim();

        return (
          <React.Fragment key={message.id}>
            {shouldShowDate && formattedDate && (
              <div
                className={`flex justify-center select-none ${
                  idx === 0 ? 'mb-4' : 'mt-6 mb-4'
                }`}
              >
                <span className="text-xs font-medium text-zinc-400">
                  {formattedDate}
                </span>
              </div>
            )}
            <div
              id={message.id}
              className={`rounded-xl border border-zinc-100 bg-white p-4 sm:p-6 shadow-sm transition-all hover:border-zinc-200 scroll-mt-6 sm:scroll-mt-8 w-full max-w-full min-w-0 ${spacingClass}`}
            >
              {/* Header: Model name & timestamp only */}
              <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-zinc-100 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full ${member.statusDotColor} shrink-0`} />
                  <span className="font-semibold text-xs text-zinc-700 truncate">
                    {member.name}
                  </span>
                </div>

                <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                  {message.timestamp}
                </span>
              </div>

              {/* Message Body */}
              {isThinking ? (
                /* Thinking Indicator Placeholder */
                <div className="py-0.5 flex items-center gap-2.5 animate-in fade-in duration-150">
                  <div className="w-3.5 h-3.5 flex items-center justify-center text-amber-500 shrink-0 animate-pulse-spin">
                    <svg viewBox="0 0 1391 1493" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5">
                      <path d="M520.475 46.8916C628.765 -15.6299 762.185 -15.6309 870.476 46.8906L1215.95 246.351C1324.24 308.872 1390.95 424.417 1390.95 549.46V948.38C1390.95 1073.42 1324.24 1188.97 1215.95 1251.49L870.476 1450.95C839.295 1468.95 806.031 1481.77 771.884 1489.4V1267.46C771.884 1224.41 793.863 1184.33 830.168 1161.2L1094.26 992.901C1130.56 969.765 1152.54 929.694 1152.54 886.644V583.73C1152.54 538.272 1128.06 496.338 1088.47 473.997L756.024 286.395C716.572 264.132 668.204 264.761 629.344 288.043L319.853 473.464C281.861 496.225 258.609 537.262 258.609 581.55V1299.76L175 1251.49C66.7098 1188.97 0 1073.42 0 948.38V549.46C0.000106195 424.417 66.7099 308.873 175 246.352L520.475 46.8916Z" fill="currentColor"/>
                      <path d="M376.402 536.352L673.55 680.923C691.417 689.616 712.339 689.37 729.998 680.259L1008.92 536.352L731.766 381.638C713.162 371.252 690.568 370.974 671.713 380.899L376.402 536.352Z" fill="currentColor"/>
                      <path d="M766.066 812.685V1103.38L1024.9 937.777C1043 926.198 1053.95 906.195 1053.95 884.71V619.578L799.12 757.258C778.757 768.259 766.066 789.54 766.066 812.685Z" fill="currentColor"/>
                      <path d="M393.853 1372.47L660.466 1492.74V824.821C660.466 801.177 647.227 779.524 626.183 768.747L356.758 630.766V1315.04C356.758 1339.81 371.273 1362.28 393.853 1372.47Z" fill="currentColor"/>
                    </svg>
                  </div>
                  <span className="text-xs font-normal animate-text-shimmer tracking-tight select-none">
                    Thinking...
                  </span>
                </div>
              ) : (
                <StreamingMessageBody
                  content={message.content}
                  isStreaming={message.isStreaming}
                />
              )}

              {/* Bottom Actions Bar: Copy & Export (Rendered once content exists) */}
              {!isThinking && (
                <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between gap-2 text-xs min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                      onClick={() => handleCopy(message.id, message.content)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-zinc-400 hover:text-zinc-700 active:bg-zinc-100 transition-colors cursor-pointer target-secondary"
                      title="Copy text"
                    >
                      {copiedId === message.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="text-[10px] text-emerald-600 font-medium">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                          <span className="text-[10px]">Copy</span>
                        </>
                      )}
                    </button>

                    {onExportMessage && (
                      <button
                        type="button"
                        onClick={() => onExportMessage(message)}
                        className="flex items-center justify-center p-1.5 px-2 rounded-md text-zinc-400 hover:text-zinc-700 active:bg-zinc-100 transition-colors cursor-pointer target-secondary"
                        title="Download response as PDF"
                        aria-label="Download response as PDF"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}

      {/* Continue Discussion Button - Fades in below final message bubble, bottom-right */}
      {canContinue && !isDebating && messages.length > 0 && onContinue && (
        <div className="w-full max-w-full flex justify-end pt-3 animate-in fade-in zoom-in-95 duration-200 min-w-0">
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-amber-50/80 active:bg-amber-100/70 border border-zinc-200/80 hover:border-amber-200/90 text-zinc-700 hover:text-zinc-900 text-xs font-medium shadow-2xs hover:shadow-xs transition-all cursor-pointer group max-w-full active:scale-98 shrink-0 target-secondary"
            title="Trigger another deliberation round on this topic"
          >
            <CornerDownRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-amber-800 transition-colors shrink-0" />
            <span className="truncate">
              <span className="sm:hidden">Keep discussing</span>
              <span className="hidden sm:inline">Let them keep discussing</span>
            </span>
          </button>
        </div>
      )}

      {/* Dynamic bottom spacer: untransitioned/instant height change so scrollHeight is immediately accurate during deliberation */}
      <div className={`w-full shrink-0 ${isDebating ? 'h-[50vh]' : 'h-0'}`} />

      {/* Invisible anchor for auto-scroll on discussion load */}
      <div ref={bottomRef} className="h-1 w-full" />

      {/* Image Lightbox Modal */}
      <ImageLightbox
        isOpen={!!lightboxImageUrl}
        onClose={() => setLightboxImageUrl(null)}
        imageUrl={lightboxImageUrl}
      />
    </div>
  );
};
