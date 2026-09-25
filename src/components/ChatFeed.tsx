'use client';

import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
  Download,
  Brain,
  Search,
  FileSearch,
  Image as ImageIcon,
  Wand2,
  FilePlus,
  FileEdit,
  Sparkles,
  Globe2,
  Clock3
} from 'lucide-react';
import {
  ChatMessage,
  ModelId,
  SeatStatus,
  SeatSearchSource,
} from '../types/chat';
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

type SeatIndicatorStatus =
  | SeatStatus
  | 'analyzing_input'
  | 'thinking_again'
  | 'considering_context';

function getSeatActivityLabel(status: SeatIndicatorStatus): string {
  switch (status) {
    case 'analyzing_input':
      return 'Analyzing input…';
    case 'thinking_again':
      return 'Thinking…';
    case 'considering_context':
      return 'Considering context…';
    case 'working':
      return 'Working through it…';
    case 'checking_documents':
      return 'Checking documents…';
    case 'checking_images':
      return 'Checking images…';
    case 'searching_web':
      return 'Searching the web…';
    case 'generating_image':
      return 'Generating image…';
    case 'editing_image':
      return 'Editing image…';
    case 'generating_pdf':
      return 'Generating PDF…';
    case 'generating_word':
      return 'Generating Word file…';
    case 'generating_file':
    case 'creating_document':
      return 'Generating file…';
    case 'editing_pdf':
      return 'Editing PDF…';
    case 'editing_word':
      return 'Editing Word file…';
    case 'editing_file':
      return 'Editing file…';
    default:
      return 'Thinking…';
  }
}

function getSearchFaviconUrl(source?: SeatSearchSource | null): string | null {
  if (!source?.url) return null;
  try {
    const parsed = new URL(source.url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

interface SeatActivityIndicatorProps {
  status: SeatStatus;
  startedAt?: string;
  searchSources?: SeatSearchSource[];
  reduceMotion?: boolean;
}

const SeatActivityIndicator: React.FC<SeatActivityIndicatorProps> = ({
  status,
  startedAt,
  searchSources = [],
  reduceMotion = false,
}) => {
  const startMs = React.useMemo(() => {
    const parsed = startedAt ? new Date(startedAt).getTime() : Date.now();
    return Number.isFinite(parsed) ? parsed : Date.now();
  }, [startedAt]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [siteIndex, setSiteIndex] = useState(0);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [startMs]);

  const elapsedMs = Math.max(0, nowMs - startMs);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const elapsedLabel = (() => {
    if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return seconds === 0
      ? `${minutes}m`
      : `${minutes}m${String(seconds).padStart(2, '0')}`;
  })();

  // UI-only fallback rhythm while the backend has not reported a concrete
  // activity yet. Real activity events always replace this immediately.
  const effectiveStatus: SeatIndicatorStatus = (() => {
    if (status !== 'thinking') return status;

    // One-way progression. Once the generic fallback reaches "working", it
    // stays there until content arrives or the backend reports a real activity.
    if (elapsedMs < 3000) return 'thinking';
    if (elapsedMs < 10000) return 'analyzing_input';
    if (elapsedMs < 15000) return 'thinking_again';
    if (elapsedMs < 22000) return 'considering_context';
    return 'working';
  })();

  useEffect(() => {
    if (effectiveStatus !== 'searching_web' || searchSources.length <= 1) {
      setSiteIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setSiteIndex((current) => (current + 1) % searchSources.length);
    }, 900);

    return () => window.clearInterval(timer);
  }, [effectiveStatus, searchSources.length]);

  const activeSource =
    effectiveStatus === 'searching_web' && searchSources.length > 0
      ? searchSources[Math.min(siteIndex, searchSources.length - 1)]
      : null;
  const faviconUrl = getSearchFaviconUrl(activeSource);

  const iconClass =
    'h-3.5 w-3.5 shrink-0 text-amber-500';
  const iconMotion =
    reduceMotion
      ? {}
      : effectiveStatus === 'searching_web'
        ? { x: [0, 1.5, -1, 0] }
        : effectiveStatus === 'generating_image' ||
            effectiveStatus === 'editing_image'
          ? { rotate: [0, -8, 8, 0], scale: [1, 1.08, 1] }
          : effectiveStatus.startsWith('generating_') ||
              effectiveStatus.startsWith('editing_')
            ? { y: [0, -1.5, 0] }
            : { opacity: [0.55, 1, 0.55] };

  const ActivityIcon = (() => {
    switch (effectiveStatus) {
      case 'working':
        return Sparkles;
      case 'analyzing_input':
        return Brain;
      case 'thinking_again':
        return Brain;
      case 'considering_context':
        return Sparkles;
      case 'checking_documents':
        return FileSearch;
      case 'checking_images':
        return ImageIcon;
      case 'searching_web':
        return Search;
      case 'generating_image':
        return ImageIcon;
      case 'editing_image':
        return Wand2;
      case 'generating_pdf':
      case 'generating_word':
      case 'generating_file':
      case 'creating_document':
        return FilePlus;
      case 'editing_pdf':
      case 'editing_word':
      case 'editing_file':
        return FileEdit;
      default:
        return Brain;
    }
  })();

  return (
    <div className="py-0.5 flex min-w-0 items-center gap-2.5 animate-in fade-in duration-150">
      <motion.div
        key={effectiveStatus}
        animate={iconMotion}
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                duration: effectiveStatus === 'searching_web' ? 1.1 : 1.4,
                repeat: Infinity,
                ease: 'easeInOut',
              }
        }
        className="flex h-4 w-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <ActivityIcon className={iconClass} />
      </motion.div>

      <div className="flex min-w-0 items-center gap-2 text-xs tracking-tight">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={effectiveStatus}
            initial={
              reduceMotion
                ? false
                : {
                    opacity: 0,
                    filter: 'blur(2px)',
                    clipPath: 'inset(0 100% 0 0)',
                    y: 1,
                  }
            }
            animate={{
              opacity: 1,
              filter: 'blur(0px)',
              clipPath: 'inset(0 0% 0 0)',
              y: 0,
            }}
            exit={
              reduceMotion
                ? { opacity: 0 }
                : {
                    opacity: 0,
                    filter: 'blur(2px)',
                    clipPath: 'inset(0 0% 0 4%)',
                    y: -1,
                  }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    opacity: { duration: 0.13 },
                    filter: { duration: 0.13 },
                    y: { duration: 0.13 },
                    clipPath: {
                      duration: 0.34,
                      ease: [0.16, 1, 0.3, 1],
                    },
                  }
            }
            className="animate-text-shimmer whitespace-nowrap font-normal tracking-tight select-none"
          >
            {getSeatActivityLabel(effectiveStatus)}
          </motion.span>
        </AnimatePresence>

        {activeSource && (
          <motion.span
            key={activeSource.url}
            initial={reduceMotion ? false : { opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            className="inline-flex min-w-0 max-w-[190px] items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-500"
            title={activeSource.title || activeSource.hostname}
          >
            <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
              <Globe2 className="absolute h-3 w-3 text-zinc-400" />
              {faviconUrl && (
                <img
                  src={faviconUrl}
                  alt=""
                  className="relative h-3 w-3 rounded-[2px] bg-white object-contain"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              )}
            </span>
            <span className="truncate">{activeSource.hostname}</span>
          </motion.span>
        )}

        <span className="ml-0.5 inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums text-zinc-400">
          <Clock3 className="h-3 w-3" aria-hidden="true" />
          {elapsedLabel}
        </span>
      </div>
    </div>
  );
};

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
      className="text-zinc-900 hover:text-zinc-600 underline underline-offset-2 font-medium transition-colors break-words [overflow-wrap:anywhere]"
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
  seatSearchSources?: Record<ModelId, SeatSearchSource[]>;
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
  onPreviewDocument?: (document: { url: string; filename: string }) => void;
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

interface ModelResponseOrbProps {
  active: boolean;
  colorClass: string;
  reduceMotion: boolean;
}

const ModelResponseOrb: React.FC<ModelResponseOrbProps> = ({
  active,
  colorClass,
  reduceMotion,
}) => {
  const shouldAnimate = active && !reduceMotion;

  return (
    <span
      className="relative inline-flex h-3 w-3 shrink-0 items-center justify-center overflow-visible"
      aria-hidden="true"
    >
      <AnimatePresence initial={false} mode="sync">
        {shouldAnimate ? (
          <motion.span
            key="response-particles"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
          >
            <motion.span
              className={`absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${colorClass}`}
              animate={{
                x: [-4, -2, 2, 4, 2, -2, -4],
                y: [0, -3.5, -3.5, 0, 3.5, 3.5, 0],
              }}
              exit={{
                x: 0,
                y: 0,
                opacity: 0,
                transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
              }}
              transition={{
                duration: 3.6,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />

            <motion.span
              className={`absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${colorClass}`}
              animate={{
                x: [2, 4, 2, -2, -4, -2, 2],
                y: [-3.5, 0, 3.5, 3.5, 0, -3.5, -3.5],
              }}
              exit={{
                x: 0,
                y: 0,
                opacity: 0,
                transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
              }}
              transition={{
                duration: 3.6,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />

            <motion.span
              className={`absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${colorClass}`}
              animate={{
                x: [2, -2, -4, -2, 2, 4, 2],
                y: [3.5, 3.5, 0, -3.5, -3.5, 0, 3.5],
              }}
              exit={{
                x: 0,
                y: 0,
                opacity: 0,
                transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
              }}
              transition={{
                duration: 3.6,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          </motion.span>
        ) : (
          <motion.span
            key="static-dot"
            className={`absolute h-2 w-2 rounded-full ${colorClass}`}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: reduceMotion ? 0 : 0.24,
              ease: [0.16, 1, 0.3, 1],
            }}
          />
        )}
      </AnimatePresence>
    </span>
  );
};

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
  seatSearchSources = {
    gemini: [],
    claude: [],
    chatgpt: [],
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
  onPreviewDocument,
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
                <div className="max-w-full sm:max-w-3xl w-fit bg-stone-100 rounded-xl p-3.5 sm:p-4.5 relative min-w-0">
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
                                onClick={() => onPreviewDocument?.({ url, filename })}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-1.5 sm:p-2 shrink-0"
                                title={`Preview ${filename}`}
                              >
                                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-red-500" />
                                <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1.5 sm:px-2 py-0.5 rounded border border-stone-200/60">
                                  PDF
                                </span>
                              </button>
                            ) : isDocx ? (
                              <button
                                type="button"
                                onClick={() => onPreviewDocument?.({ url, filename })}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-1.5 sm:p-2 shrink-0"
                                title={`Preview ${filename}`}
                              >
                                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
                                <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1.5 sm:px-2 py-0.5 rounded border border-stone-200/60">
                                  DOCX
                                </span>
                              </button>
                            ) : isText ? (
                              <button
                                type="button"
                                onClick={() => onPreviewDocument?.({ url, filename })}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-1.5 sm:p-2 shrink-0"
                                title={`Preview ${filename}`}
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
                                onClick={() => onPreviewDocument?.({ url, filename })}
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
        const attachments: string[] =
          message.attachment_urls && message.attachment_urls.length > 0
            ? message.attachment_urls
            : [];
        const imageAttachments = attachments.filter((url) => {
          const filename = getAttachmentDisplayFilename(url);
          return isImageUrl(url, filename);
        });
        const documentAttachments = attachments.filter((url) => {
          const filename = getAttachmentDisplayFilename(url);
          return !isImageUrl(url, filename);
        });

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
                  <ModelResponseOrb
                    active={Boolean(message.isStreaming)}
                    colorClass={member.statusDotColor}
                    reduceMotion={Boolean(shouldReduceMotion)}
                  />
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
                <SeatActivityIndicator
                  status={seatStatuses[modelKey] || 'thinking'}
                  startedAt={message.createdAt}
                  searchSources={seatSearchSources[modelKey] || []}
                  reduceMotion={Boolean(shouldReduceMotion)}
                />
              ) : (
                <>
                  <StreamingMessageBody
                    content={message.content}
                    isStreaming={message.isStreaming}
                  />

                  {/* Attached Images (if present) */}
                  {imageAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 sm:gap-2.5 mt-3 max-w-full min-w-0">
                      {imageAttachments.map((url, i) => {
                        const filename = getAttachmentDisplayFilename(url);
                        return (
                          <div key={`${url}-${i}`} className="flex flex-col items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setLightboxImageUrl(url)}
                              className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-zinc-200/90 bg-zinc-100 shadow-2xs block cursor-pointer hover:opacity-90 transition-opacity shrink-0"
                              title={`Click to view ${filename}`}
                            >
                              <img
                                src={url}
                                alt={filename}
                                className="w-full h-full object-cover"
                              />
                            </button>
                            <span
                              className="text-[10px] sm:text-[11px] font-mono text-zinc-500 hover:text-zinc-700 max-w-[80px] sm:max-w-[112px] truncate px-1 text-center select-all"
                              title={filename}
                            >
                              {filename}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Generated/downloadable documents (if present) */}
                  {documentAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 sm:gap-2.5 mt-3 max-w-full min-w-0">
                      {documentAttachments.map((url, i) => {
                        const filename = getAttachmentDisplayFilename(url);
                        const lowerFilename = filename.toLowerCase();
                        const isPdfDocument = lowerFilename.endsWith('.pdf');
                        const isDocxDocument = lowerFilename.endsWith('.docx');
                        const isTextDocument =
                          isTextFileUrl(url) || isTextFileName(lowerFilename);
                        const documentBadge = isPdfDocument
                          ? 'PDF'
                          : isDocxDocument
                            ? 'DOCX'
                            : isTextDocument
                              ? getTextFileDisplayBadge(filename)
                              : 'FILE';
                        const documentIconClass = isPdfDocument
                          ? 'text-red-500'
                          : isDocxDocument
                            ? 'text-blue-600'
                            : isTextDocument
                              ? 'text-emerald-600'
                              : 'text-zinc-600';

                        return (
                          <div key={`${url}-doc-${i}`} className="flex flex-col items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => onPreviewDocument?.({ url, filename })}
                              className="w-20 h-20 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-zinc-200/90 bg-zinc-100 shadow-2xs flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-zinc-200/70 transition-colors p-1.5 sm:p-2 shrink-0"
                              title={`Preview ${filename}`}
                            >
                              <FileText
                                className={`w-6 h-6 sm:w-8 sm:h-8 ${documentIconClass}`}
                              />
                              <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1.5 sm:px-2 py-0.5 rounded border border-zinc-200/60">
                                {documentBadge}
                              </span>
                            </button>
                            <span
                              className="text-[10px] sm:text-[11px] font-mono text-zinc-500 hover:text-zinc-700 max-w-[80px] sm:max-w-[112px] truncate px-1 text-center select-all"
                              title={filename}
                            >
                              {filename}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
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
