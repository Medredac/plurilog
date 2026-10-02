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
  Eye,
  Brain,
  Search,
  FileSearch,
  Image as ImageIcon,
  Wand2,
  FilePlus,
  FileEdit,
  Sparkles,
  Globe2,
  Clock3,
  History,
  BookOpen,
  RefreshCw
} from 'lucide-react';
import {
  ChatMessage,
  ModelId,
  SeatStatus,
  SeatSearchSource,
} from '../types/chat';
import { COUNCIL_MEMBERS } from '../data/mockDebates';
import { ImageLightbox } from './ImageLightbox';
import { ProviderBadge } from './ProviderBadge';
import { isTextFileUrl, isTextFileName, getTextFileDisplayBadge } from '@/utils/textFileParser';
import { isImageUrl } from '@/utils/discussionMemory';
import { useTopTurnAnchor } from '@/hooks/useTopTurnAnchor';
import {
  PresentationPhase,
  usePresentationSequence,
} from '@/hooks/usePresentationSequence';

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

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (target === today) return 'Today';
  if (target === today - dayMs) return 'Yesterday';
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

const USER_MESSAGE_URL_REGEX = /(?:https?:\/\/|www\.)[^\s<]+/gi;

function renderUserMessageContent(content: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of content.matchAll(USER_MESSAGE_URL_REGEX)) {
    const start = match.index ?? 0;
    const rawMatch = match[0];

    if (start > cursor) {
      nodes.push(content.slice(cursor, start));
    }

    // Keep sentence punctuation outside the clickable URL while preserving
    // everything the user typed exactly as visible text.
    const trailingMatch = rawMatch.match(/[.,;:!]+$/);
    const trailing = trailingMatch?.[0] || '';
    const visibleUrl = trailing
      ? rawMatch.slice(0, rawMatch.length - trailing.length)
      : rawMatch;
    const href = visibleUrl.toLowerCase().startsWith('www.')
      ? `https://${visibleUrl}`
      : visibleUrl;

    nodes.push(
      <a
        key={`user-url-${start}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 decoration-stone-400 hover:decoration-stone-700 hover:text-stone-700 transition-colors [overflow-wrap:anywhere]"
      >
        {visibleUrl}
      </a>
    );

    if (trailing) nodes.push(trailing);
    cursor = start + rawMatch.length;
  }

  if (cursor < content.length) {
    nodes.push(content.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [content];
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
    case 'waiting':
      return 'Preparing…';
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
    case 'searching_conversation':
      return 'Searching earlier messages…';
    case 'checking_chronology':
      return 'Checking the conversation timeline…';
    case 'reading_context':
      return 'Reading more context…';
    case 'searching_documents':
      return 'Searching earlier documents…';
    case 'locating_evidence':
      return 'Locating the referenced source…';
    case 'reviewing_evidence':
      return 'Reviewing findings…';
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

function getFaviconUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return null;
  }
}

function getSearchFaviconUrl(source?: SeatSearchSource | null): string | null {
  return getFaviconUrl(source?.url);
}

interface SeatActivityIndicatorProps {
  status: SeatStatus;
  provider?: ModelId;
  startedAt?: string;
  searchSources?: SeatSearchSource[];
  activityLabel?: string | null;
  reduceMotion?: boolean;
}

const SeatActivityIndicator: React.FC<SeatActivityIndicatorProps> = ({
  status,
  provider = 'chatgpt',
  startedAt,
  searchSources = [],
  activityLabel = null,
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

  // Preserve the familiar fallback rhythm while the model is reasoning
  // silently. Any concrete backend activity (memory search, chronology,
  // document lookup, web search, generation/editing, etc.) replaces this
  // immediately because status will no longer be "thinking".
  const effectiveStatus: SeatIndicatorStatus = (() => {
    if (status !== 'thinking') return status;

    if (elapsedMs < 3000) return 'thinking';
    if (elapsedMs < 10000) return 'analyzing_input';
    if (elapsedMs < 15000) return 'thinking_again';
    if (elapsedMs < 22000) return 'considering_context';
    return 'working';
  })();
  const rawDisplayLabel =
    activityLabel?.trim() || getSeatActivityLabel(effectiveStatus);
  const displayLabel = rawDisplayLabel.replace(/(?:…|\.\.\.)\s*$/, '');

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
      case 'waiting':
        return Clock3;
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
      case 'searching_conversation':
        return Search;
      case 'checking_chronology':
        return History;
      case 'reading_context':
        return BookOpen;
      case 'searching_documents':
        return FileSearch;
      case 'locating_evidence':
        return Search;
      case 'reviewing_evidence':
        return Sparkles;
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
    <div className="py-0.5 inline-flex max-w-full min-w-0 items-center gap-2 text-[13px] animate-in fade-in duration-150">
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
          <ActivityIcon className="thinking-icon-silver h-3.5 w-3.5" />
        </motion.div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={`${effectiveStatus}:${displayLabel}`}
            initial={reduceMotion ? false : { opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
            className="animate-text-shimmer min-w-0 truncate whitespace-nowrap font-normal tracking-tight select-none"
          >
            {displayLabel}
          </motion.span>
        </AnimatePresence>

        <span className="inline-flex shrink-0 items-center gap-[3px]" aria-hidden="true">
          {[0, 1, 2].map((_, index) => (
            <motion.span
              key={index}
              className="thinking-dot-shimmer h-1 w-1 rounded-full"
              animate={
                reduceMotion
                  ? undefined
                  : {
                      y: [0, -1.5, 0],
                      opacity: [0.5, 1, 0.5],
                    }
              }
              transition={{
                duration: 0.9,
                repeat: Infinity,
                delay: index * 0.12,
                ease: 'easeInOut',
              }}
            />
          ))}
        </span>

        {activeSource && (
          <motion.span
            key={activeSource.url}
            initial={reduceMotion ? false : { opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            className="inline-flex min-w-0 max-w-[170px] items-center gap-1.5 rounded-full border border-[#E2E0DB] bg-[#F7F6F3] px-2 py-0.5 text-[10px] font-medium text-[#6A675F]"
            title={activeSource.title || activeSource.hostname}
          >
            <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
              <Globe2 className="absolute h-3 w-3 text-[#8A867D]" />
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

        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-[#8A867D]">
          <Clock3 className="h-3 w-3" aria-hidden="true" />
          {elapsedLabel}
        </span>
    </div>
  );
};

const BLOCKED_SVG_TAGS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'image',
  'link',
  'style',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
]);

function sanitizeStandaloneSvg(rawSvg: string): string | null {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return null;

  const trimmed = rawSvg.trim();
  if (!/^<svg(?:\s|>)/i.test(trimmed) || !/<\/svg>\s*$/i.test(trimmed)) {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;

  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();
    if (BLOCKED_SVG_TAGS.has(tagName)) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (
        name.startsWith('on') ||
        name === 'href' ||
        name === 'xlink:href' ||
        name === 'src'
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (/javascript:/i.test(value) || /data:text\/html/i.test(value)) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (/url\s*\(/i.test(value) && !/url\s*\(\s*#[-_a-z0-9]+\s*\)/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  if (!root.getAttribute('xmlns')) {
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  return new XMLSerializer().serializeToString(root);
}

const SvgCodeBlock: React.FC<{ children?: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => {
  const codeContent = String(children || '').replace(/\n$/, '');
  const [safeSvg, setSafeSvg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sanitized = sanitizeStandaloneSvg(codeContent);
    setSafeSvg(sanitized);

    if (!sanitized) {
      setPreviewUrl(null);
      return;
    }

    const blobUrl = URL.createObjectURL(
      new Blob([sanitized], { type: 'image/svg+xml;charset=utf-8' })
    );
    setPreviewUrl(blobUrl);

    return () => URL.revokeObjectURL(blobUrl);
  }, [codeContent]);

  if (!safeSvg || !previewUrl) {
    return <CodeBlock className={className}>{children}</CodeBlock>;
  }

  const handleDownload = (event: React.MouseEvent) => {
    event.stopPropagation();
    const url = URL.createObjectURL(
      new Blob([safeSvg], { type: 'image/svg+xml;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vector-artwork.svg';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(codeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 w-full max-w-full overflow-hidden rounded-xl border border-zinc-200/80 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200/70 bg-[#f8f8f8] px-3.5 py-2">
        <div className="flex items-center gap-2 text-zinc-600">
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold">SVG preview</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200/70 hover:text-[#1C1B1A]"
            title="Download SVG"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download SVG
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200/70 hover:text-[#1C1B1A]"
            title="Copy SVG code"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy SVG'}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setShowCode((current) => !current);
            }}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200/70 hover:text-[#1C1B1A]"
            title={showCode ? 'Hide SVG code' : 'View SVG code'}
          >
            {showCode ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {showCode ? 'Hide code' : 'View code'}
          </button>
        </div>
      </div>

      <div className="flex min-h-36 items-center justify-center bg-white p-5">
        <img
          src={previewUrl}
          alt="AI-generated SVG preview"
          className="max-h-64 max-w-full object-contain"
        />
      </div>

      {showCode && (
        <div className="border-t border-zinc-200/70">
          <CodeBlock className={className || 'language-svg'}>{codeContent}</CodeBlock>
        </div>
      )}
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
    <div className="relative my-3 rounded-xl border border-zinc-200/80 bg-[#f8f8f8] overflow-hidden group text-left w-full max-w-full min-w-0">
      {/* Top Header Bar with Language tag and Copy Button (Neutral light grey styling) */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#f4f4f4] border-b border-zinc-200/70 text-[#6A675F] min-w-0">
        <span className="text-[11px] font-mono font-medium lowercase tracking-wide text-[#6A675F] truncate">
          {language !== 'text' ? language : 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 sm:py-0.5 rounded-md text-[#6A675F] hover:text-[#1C1B1A] hover:bg-zinc-200/70 active:bg-zinc-300/60 transition-colors cursor-pointer shrink-0"
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
          className="font-mono text-[0.875em] bg-zinc-100 text-[#1C1B1A] px-1.5 py-0.5 rounded-md border border-zinc-200/60 font-normal break-words [overflow-wrap:anywhere]"
          {...props}
        >
          {children}
        </code>
      );
    }

    const codeContent = String(children || '').replace(/\n$/, '');
    const language = match ? match[1].toLowerCase() : '';
    const looksLikeStandaloneSvg =
      language === 'svg' ||
      (/^<svg(?:\s|>)/i.test(codeContent.trim()) && /<\/svg>\s*$/i.test(codeContent.trim()));

    if (looksLikeStandaloneSvg) {
      return <SvgCodeBlock className={className || 'language-svg'}>{children}</SvgCodeBlock>;
    }

    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  p: ({ children }) => (
    <p className="text-base sm:text-[16.5px] text-[#1C1B1A] leading-relaxed font-normal mb-3 last:mb-0 break-words [overflow-wrap:anywhere]">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-2.5 pl-5 list-disc space-y-1 text-[#1C1B1A] text-base sm:text-[16.5px] break-words">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 pl-5 list-decimal space-y-1 text-[#1C1B1A] text-base sm:text-[16.5px] break-words">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed text-[#1C1B1A] text-base sm:text-[16.5px] break-words">
      {children}
    </li>
  ),
  h1: ({ children }) => (
    <h1 className="font-semibold text-lg sm:text-xl text-[#1C1B1A] mt-4 mb-2 break-words">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-semibold text-base sm:text-lg text-[#1C1B1A] mt-3.5 mb-1.5 break-words">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-semibold text-sm sm:text-base text-[#1C1B1A] mt-3 mb-1 break-words">
      {children}
    </h3>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#1C1B1A]">{children}</strong>
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
      className="text-[#1C1B1A] hover:text-zinc-600 underline underline-offset-2 font-medium transition-colors break-words [overflow-wrap:anywhere]"
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
    <tbody className="divide-y divide-zinc-100 bg-white text-[#1C1B1A]">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-zinc-50/50 transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-xs font-semibold text-[#1C1B1A] whitespace-nowrap">
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
  seatActivityLabels?: Record<ModelId, string | null>;
  seatSearchSources?: Record<ModelId, SeatSearchSource[]>;
  seatOrder?: ModelId[];
  activeModels?: ModelId[];
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
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  viewMode?: 'discussion' | 'side-by-side';
}

/**
 * Advance to a natural presentation boundary. Latin text is revealed by words;
 * CJK text is allowed to progress character-by-character instead of waiting for
 * whitespace that may never arrive.
 */
function nextStreamingRevealBoundary(
  text: string,
  start: number,
  maxUnits: number
): number {
  let cursor = Math.max(0, Math.min(start, text.length));
  let units = 0;
  const isCjk = (char: string) =>
    /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(char);

  while (cursor < text.length && units < maxUnits) {
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
    if (cursor >= text.length) break;

    if (isCjk(text[cursor])) {
      cursor += 1;
      units += 1;
    } else {
      while (
        cursor < text.length &&
        !/\s/u.test(text[cursor]) &&
        !isCjk(text[cursor])
      ) {
        cursor += 1;
      }
      units += 1;
    }

    while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
  }

  return cursor;
}

interface SmoothRevealResult {
  text: string;
  isRevealing: boolean;
}

/**
 * Presentation-only smoothing for uneven provider/SSE chunks.
 *
 * The authoritative message still arrives and persists exactly as generated.
 * This layer only meters the visible text into small word-sized increments.
 * Crucially, when the backend finishes first, the visual queue drains instead
 * of snapping the unrevealed tail onto screen in one block.
 */
function useSmoothReveal(
  targetText: string,
  isStreaming: boolean | undefined,
  reduceMotion: boolean | undefined,
  presentationPhase: PresentationPhase,
  onPresentationComplete?: () => void
): SmoothRevealResult {
  const isStatic =
    presentationPhase === 'static' || presentationPhase === 'complete';
  const shouldStartHidden =
    !reduceMotion &&
    (presentationPhase === 'queued' || presentationPhase === 'active');

  const [displayedLength, setDisplayedLength] = useState(() =>
    shouldStartHidden ? 0 : targetText.length
  );
  const [isDraining, setIsDraining] = useState(false);

  const targetTextRef = useRef(targetText);
  targetTextRef.current = targetText;

  const isStreamingRef = useRef(Boolean(isStreaming));
  isStreamingRef.current = Boolean(isStreaming);

  const displayedLengthRef = useRef(displayedLength);
  displayedLengthRef.current = displayedLength;

  const completionNotifiedRef = useRef(false);
  const onPresentationCompleteRef = useRef(onPresentationComplete);
  onPresentationCompleteRef.current = onPresentationComplete;

  useEffect(() => {
    if (presentationPhase !== 'active') {
      completionNotifiedRef.current = false;
    }

    if (presentationPhase === 'queued') {
      displayedLengthRef.current = 0;
      setDisplayedLength(0);
      setIsDraining(false);
      return;
    }

    if (isStatic) {
      displayedLengthRef.current = targetText.length;
      setDisplayedLength(targetText.length);
      setIsDraining(false);
      return;
    }

    const notifyComplete = () => {
      if (completionNotifiedRef.current) return;
      completionNotifiedRef.current = true;
      onPresentationCompleteRef.current?.();
    };

    if (reduceMotion) {
      displayedLengthRef.current = targetText.length;
      setDisplayedLength(targetText.length);
      setIsDraining(false);
      if (!isStreamingRef.current) {
        queueMicrotask(notifyComplete);
      }
      return;
    }

    if (displayedLengthRef.current > targetText.length) {
      displayedLengthRef.current = targetText.length;
      setDisplayedLength(targetText.length);
    }

    if (displayedLengthRef.current >= targetText.length) {
      setIsDraining(false);
      if (!isStreamingRef.current) {
        queueMicrotask(notifyComplete);
      }
      return;
    }

    setIsDraining(true);
    let rafId: number | null = null;
    let lastTime = 0;

    const tick = (now: number) => {
      const current = displayedLengthRef.current;
      const currentTarget = targetTextRef.current.length;

      if (current >= currentTarget) {
        setIsDraining(false);
        rafId = null;
        if (!isStreamingRef.current) {
          queueMicrotask(notifyComplete);
        }
        return;
      }

      const lag = currentTarget - current;

      // Presentation speed responds to backlog, not provider chunk size.
      // Even a one-shot provider dump is metered through the same visual queue.
      const intervalMs =
        lag > 1800 ? 18 :
        lag > 1000 ? 20 :
        lag > 500 ? 22 :
        lag > 220 ? 25 :
        29;

      const unitsPerTick =
        lag > 1800 ? 9 :
        lag > 1000 ? 7 :
        lag > 500 ? 5 :
        lag > 220 ? 3 :
        lag > 80 ? 2 :
        1;

      if (now - lastTime >= intervalMs) {
        lastTime = now;
        let nextLength = nextStreamingRevealBoundary(
          targetTextRef.current,
          current,
          unitsPerTick
        );

        if (nextLength <= current) {
          nextLength = Math.min(currentTarget, current + 1);
        }

        displayedLengthRef.current = Math.min(nextLength, currentTarget);
        setDisplayedLength(displayedLengthRef.current);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [
    isStatic,
    isStreaming,
    presentationPhase,
    reduceMotion,
    targetText,
  ]);

  const visibleLength = Math.min(displayedLength, targetText.length);

  return {
    text: targetText.slice(0, visibleLength),
    isRevealing:
      presentationPhase === 'active' &&
      !reduceMotion &&
      (Boolean(isStreaming) ||
        isDraining ||
        visibleLength < targetText.length),
  };
}

/**
 * During active reveal, split rendered Markdown text nodes into stable word
 * spans. React keeps existing spans mounted, so newly appended words receive
 * an actual soft fade/blur entrance instead of the whole paragraph changing at
 * once.
 */
function rehypeStreamingWordFade() {
  const skippedTags = new Set(['code', 'pre', 'script', 'style']);

  return (tree: any) => {
    const walk = (node: any, insideSkippedTag = false) => {
      if (!node || !Array.isArray(node.children)) return;

      const skipChildren =
        insideSkippedTag ||
        (typeof node.tagName === 'string' && skippedTags.has(node.tagName));

      const nextChildren: any[] = [];

      for (const child of node.children) {
        if (
          !skipChildren &&
          child?.type === 'text' &&
          typeof child.value === 'string' &&
          /\S/u.test(child.value)
        ) {
          const pieces = child.value.match(/\s+|\S+/gu) || [child.value];
          for (const piece of pieces) {
            if (/^\s+$/u.test(piece)) {
              nextChildren.push({ type: 'text', value: piece });
            } else {
              nextChildren.push({
                type: 'element',
                tagName: 'span',
                properties: { className: ['streaming-word-reveal'] },
                children: [{ type: 'text', value: piece }],
              });
            }
          }
          continue;
        }

        walk(child, skipChildren);
        nextChildren.push(child);
      }

      node.children = nextChildren;
    };

    walk(tree);
  };
}

interface StreamingMessageBodyProps {
  content: string;
  isStreaming?: boolean;
  reduceMotion?: boolean;
  presentationPhase: PresentationPhase;
  onPresentationComplete?: () => void;
}

const StreamingMessageBody: React.FC<StreamingMessageBodyProps> = ({
  content,
  isStreaming,
  reduceMotion,
  presentationPhase,
  onPresentationComplete,
}) => {
  // Separate trailing Sources footer before visual smoothing so raw Sources markdown is never shown in prose
  const { mainContent, sources } = parseTrailingSources(content);
  const {
    text: displayedMainContent,
    isRevealing,
  } = useSmoothReveal(
    mainContent,
    isStreaming,
    reduceMotion,
    presentationPhase,
    onPresentationComplete
  );

  return (
    <div className="space-y-3.5 min-w-0 max-w-full">
      {/* Message Body with real ReactMarkdown rendering */}
      <div className="text-base sm:text-[16.5px] text-[#1C1B1A] leading-relaxed font-normal min-w-0 max-w-full [overflow-wrap:anywhere]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={isRevealing ? [rehypeStreamingWordFade] : []}
          components={markdownComponents}
        >
          {displayedMainContent}
        </ReactMarkdown>
        {isRevealing && (
          <span className="streaming-caret" aria-hidden="true" />
        )}
      </div>

      {/* Sources Area */}
      {!isRevealing && sources && sources.length > 0 && (
        <div className="pt-2.5 border-t border-zinc-100 flex flex-col gap-2 min-w-0 max-w-full">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider select-none">
            Sources
          </span>
          <div className="flex flex-wrap gap-1.5 sm:gap-2 max-w-full min-w-0">
            {sources.map((source, i) => {
              const faviconUrl = getFaviconUrl(source.url);
              return (
                <a
                  key={`${source.url}-${i}`}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-50 hover:bg-zinc-100 active:bg-zinc-200/70 border border-zinc-200/80 text-zinc-700 hover:text-[#1C1B1A] text-xs font-medium transition-colors group cursor-pointer max-w-full min-w-0"
                  title={source.title}
                >
                  <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    <Globe2 className="absolute h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                    {faviconUrl && (
                      <img
                        src={faviconUrl}
                        alt=""
                        className="relative h-3.5 w-3.5 rounded-[2px] bg-white object-contain"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                  </span>
                  <span className="truncate max-w-[170px] sm:max-w-[300px]">
                    {source.title}
                  </span>
                  <span className="text-zinc-400 group-hover:text-zinc-600 shrink-0 text-[11px] select-none">
                    ↗
                  </span>
                </a>
              );
            })}
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
  seatActivityLabels = {
    gemini: null,
    claude: null,
    chatgpt: null,
  },
  seatSearchSources = {
    gemini: [],
    claude: [],
    chatgpt: [],
  },
  seatOrder = ['chatgpt', 'claude', 'gemini'],
  activeModels = ['chatgpt', 'claude', 'gemini'],
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
  scrollContainerRef,
  viewMode = 'discussion',
}) => {
  const shouldReduceMotion = useReducedMotion();
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastActiveDebateIdRef = useRef<string | null>(null);
  const lastUserMsgIdRef = useRef<string | null>(null);
  const knownModelMessageIdsRef = useRef<Set<string> | null>(null);

  if (knownModelMessageIdsRef.current === null) {
    knownModelMessageIdsRef.current = new Set(
      messages.filter((message) => message.role === 'model').map((message) => message.id)
    );
  }

  const freshModelMessageIds = new Set(
    messages
      .filter(
        (message) =>
          message.role === 'model' &&
          !knownModelMessageIdsRef.current!.has(message.id)
      )
      .map((message) => message.id)
  );

  useEffect(() => {
    for (const message of messages) {
      if (message.role === 'model') {
        knownModelMessageIdsRef.current?.add(message.id);
      }
    }
  }, [messages]);

  const [revealingMessageIds, setRevealingMessageIds] = useState<Set<string>>(
    () => new Set()
  );

  const handleRevealStateChange = React.useCallback(
    (messageId: string, isRevealing: boolean) => {
      setRevealingMessageIds((previous) => {
        const next = new Set(previous);
        if (isRevealing) next.add(messageId);
        else next.delete(messageId);

        if (
          next.size === previous.size &&
          [...next].every((id) => previous.has(id))
        ) {
          return previous;
        }
        return next;
      });
    },
    []
  );

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedMsgIds, setExpandedMsgIds] = useState<Record<string, boolean>>({});
  const [collapsedAiMsgIds, setCollapsedAiMsgIds] = useState<Record<string, boolean>>({});
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

  // 2. On a new user turn (including Continue), glide that turn into a stable
  //    reading position near the top of the chat viewport, then hold still while
  //    the model responses grow underneath it.
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

    if (!candidate || candidate.id === lastUserMsgIdRef.current) return;

    // Wait for React + layout (including the debating spacer) to settle before
    // measuring. Two RAFs avoids the old race where scrolling sometimes fired
    // against the previous layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(candidate.id);
        if (!el) return;

        const scroller = el.closest('.overflow-y-auto') as HTMLElement | null;
        if (!scroller) {
          el.scrollIntoView({
            behavior: shouldReduceMotion ? 'auto' : 'smooth',
            block: 'start',
          });
          lastUserMsgIdRef.current = candidate.id;
          return;
        }

        const scrollerRect = scroller.getBoundingClientRect();
        const targetRect = el.getBoundingClientRect();
        const isContinueTurn = candidate.content === 'Continue';
        const isDesktop = window.matchMedia('(min-width: 640px)').matches;
        // The old Continue turn had an extra mt-10 / sm:mt-12 before its
        // scroll target. Preserve that visual breathing room even though the
        // redesigned Round marker remains intentionally hidden until output.
        const topOffset = isContinueTurn
          ? (isDesktop ? 80 : 64)
          : (isDesktop ? 32 : 24);
        const targetTop =
          scroller.scrollTop + (targetRect.top - scrollerRect.top) - topOffset;

        scroller.scrollTo({
          top: Math.max(0, targetTop),
          behavior: shouldReduceMotion ? 'auto' : 'smooth',
        });

        // Mark handled only after a real DOM target exists. This is important
        // for Continue, whose visible Round marker intentionally stays hidden
        // until at least one AI has produced real output.
        lastUserMsgIdRef.current = candidate.id;
      });
    });
  }, [messages, shouldReduceMotion]);

  const toggleExpand = (id: string) => {
    setExpandedMsgIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const toggleAiCollapse = (id: string) => {
    setCollapsedAiMsgIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const activeModelSet = new Set(activeModels);
  const orderedActiveModels = seatOrder.filter((id) => activeModelSet.has(id));

  return (
    <div className={`pl-[max(clamp(0.75rem,calc(2vw_+_0.25rem),2rem),env(safe-area-inset-left))] pr-[max(clamp(0.75rem,calc(2vw_+_0.25rem),2rem),env(safe-area-inset-right))] pt-5 sm:pt-7 pb-6 mx-auto w-full min-w-0 ${
      viewMode === 'side-by-side'
        ? 'max-w-[1040px] grid grid-cols-1 sm:grid-cols-3 gap-x-[14px] gap-y-4'
        : 'max-w-[760px] flex flex-col'
    }`}>
      {/* Error Notice (Non-turn errors, e.g. upload/storage issues) */}
      {errorMessage && (
        <div className="col-span-full p-3.5 mb-5 rounded-[14px] bg-white border border-[#E2E0DB] text-[#B5432E] text-xs flex items-start gap-2.5 min-w-0 max-w-full">
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
          const hasAnswerBeforeNextUser = (continueIndex: number) => {
            for (let index = continueIndex + 1; index < messages.length; index += 1) {
              const item = messages[index];
              if (item.role === 'user') return false;
              if (item.role === 'model' && item.content.trim()) return true;
            }
            return false;
          };

          const hasRoundOutput = hasAnswerBeforeNextUser(idx);
          const hasLaterUserTurn = messages
            .slice(idx + 1)
            .some((item) => item.role === 'user');
          const isPendingCurrentRound =
            isDebating && !hasRoundOutput && !hasLaterUserTurn;

          // Show the current Round marker immediately while the round is
          // running. If the user stops before any AI output, runRelay removes
          // this Continue message entirely, so the empty Round disappears.
          // Historical unanswered Continue markers remain hidden.
          if (!hasRoundOutput && !isPendingCurrentRound) {
            return null;
          }

          let roundNumber = 0;
          for (let index = idx; index >= 0; index -= 1) {
            const item = messages[index];
            if (item.role !== 'user') continue;
            if (item.content !== 'Continue') break;

            const isCurrentPendingMarker =
              index === idx && isPendingCurrentRound;
            if (hasAnswerBeforeNextUser(index) || isCurrentPendingMarker) {
              roundNumber += 1;
            }
          }

          return (
            <React.Fragment key={message.id}>
              {shouldShowDate && formattedDate && (
                <div
                  className={`col-span-full flex justify-center select-none ${
                    idx === 0 ? 'mb-4' : 'mt-6 mb-4'
                  }`}
                >
                  <span className="text-xs font-normal text-[#8A867D]">
                    {formattedDate}
                  </span>
                </div>
              )}
              <div
                id={message.id}
                className="col-span-full flex items-center gap-3 py-5 scroll-mt-6 sm:scroll-mt-8"
              >
                <div className="h-px flex-1 bg-[#E7E5E0]" />
                <span className="text-xs font-medium text-[#6A675F]">
                  Round {roundNumber}
                </span>
                <div className="h-px flex-1 bg-[#E7E5E0]" />
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
                  className={`col-span-full flex justify-center select-none ${
                    idx === 0 ? 'mb-4' : 'mt-6 mb-4'
                  }`}
                >
                  <span className="text-xs font-normal text-[#8A867D]">
                    {formattedDate}
                  </span>
                </div>
              )}
              <motion.div 
                id={message.id}
                initial={
                  message.id === newlySentUserMessageId
                    ? { opacity: 0, y: shouldReduceMotion ? 0 : 16 }
                    : false
                }
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: shouldReduceMotion ? 0 : 0.24,
                  ease: [0.16, 1, 0.3, 1],
                }}
                onAnimationComplete={() => {
                  if (message.id === newlySentUserMessageId && onNewlySentAnimationComplete) {
                    onNewlySentAnimationComplete();
                  }
                }}
                className={`col-span-full flex flex-col items-end scroll-mt-6 sm:scroll-mt-8 w-full min-w-0 ${
                  shouldShowDate || idx === 0 ? 'mt-0' : 'mt-10 sm:mt-12'
                }`}
              >
                {/* Attached files */}
                  {attachments.length > 0 && (
                    <div className="mb-2.5 flex w-full max-w-[480px] min-w-0 flex-wrap justify-end gap-2 sm:gap-2.5">
                      {attachments.map((url, i) => {
                        const filename = getAttachmentDisplayFilename(url);
                        const cleanLower = (url.split('?')[0].split('#')[0] || '').toLowerCase();
                        const fnLower = filename.toLowerCase();

                        const isPdf = cleanLower.endsWith('.pdf') || fnLower.endsWith('.pdf');
                        const isDocx = cleanLower.endsWith('.docx') || fnLower.endsWith('.docx');
                        const isText = isTextFileUrl(cleanLower) || isTextFileName(fnLower);
                        const isImage = isImageUrl(url, filename);

                        if (isPdf || isDocx) {
                          const documentTypeLabel = isPdf ? 'PDF document' : 'Word document';
                          const documentIconSrc = isPdf
                            ? '/file-icon-pdf.svg'
                            : '/file-icon-docx.svg';
                          const openPreview = () =>
                            onPreviewDocument?.({ url, filename });

                          return (
                            <div
                              key={`${message.id}-attachment-${i}`}
                              role="button"
                              tabIndex={0}
                              onClick={openPreview}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openPreview();
                                }
                              }}
                              className="group flex min-h-[64px] w-[330px] max-w-full cursor-pointer items-center gap-3 rounded-[12px] border border-[#E2E0DB] bg-white px-2.5 py-2 transition-colors hover:border-[#D9D6CF] hover:bg-[#F7F6F3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D9D6CF]"
                              title={`Preview ${filename}`}
                              aria-label={`Preview ${filename}`}
                            >
                              <div className="flex h-14 w-11 shrink-0 items-center justify-center">
                                <img
                                  src={documentIconSrc}
                                  alt=""
                                  className="h-14 w-11 object-contain"
                                  aria-hidden="true"
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <p
                                  className="line-clamp-2 break-all text-[12px] font-medium leading-[15px] text-[#1C1B1A]"
                                  title={filename}
                                >
                                  {filename}
                                </p>
                                <p className="mt-1 text-[10px] leading-4 text-[#6A675F]">
                                  {documentTypeLabel}
                                </p>
                              </div>

                              <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openPreview();
                                  }}
                                  className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] border border-[#E2E0DB] bg-white text-[#6A675F] transition-colors hover:bg-[#EFEDE9] hover:text-[#1C1B1A]"
                                  title={`Preview ${filename}`}
                                  aria-label={`Preview ${filename}`}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                                <a
                                  href={url}
                                  download={filename}
                                  onClick={(event) => event.stopPropagation()}
                                  className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] border border-[#E2E0DB] bg-white text-[#6A675F] transition-colors hover:bg-[#EFEDE9] hover:text-[#1C1B1A]"
                                  title={`Download ${filename}`}
                                  aria-label={`Download ${filename}`}
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </a>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={`${message.id}-attachment-${i}`} className="flex flex-col items-center gap-1 shrink-0">
                            {isText ? (
                              <button
                                type="button"
                                onClick={() => onPreviewDocument?.({ url, filename })}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-[24px] overflow-hidden border border-[#D9D6CF] bg-stone-200/50 flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-1.5 sm:p-2 shrink-0"
                                title={`Preview ${filename}`}
                              >
                                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-600" />
                                <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1.5 sm:px-2 py-0.5 rounded border border-[#D9D6CF]">
                                  {getTextFileDisplayBadge(filename)}
                                </span>
                              </button>
                            ) : isImage ? (
                              <button
                                type="button"
                                onClick={() => setLightboxImageUrl(url)}
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-[24px] overflow-hidden border border-[#D9D6CF] bg-stone-200/50 block cursor-pointer hover:opacity-90 transition-opacity shrink-0"
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
                                className="w-20 h-20 sm:w-28 sm:h-28 rounded-[24px] overflow-hidden border border-[#D9D6CF] bg-stone-200/50 flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-1.5 sm:p-2 shrink-0"
                                title={`Click to view ${filename}`}
                              >
                                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-zinc-600" />
                                <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-1.5 sm:px-2 py-0.5 rounded border border-[#D9D6CF]">
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



                {message.content?.trim() ? (
                  <div className="max-w-[88%] sm:max-w-[480px] w-fit bg-[#EFEDE9] rounded-[18px_18px_6px_18px] px-4 py-3 relative min-w-0 text-[16px] leading-6 text-[#1C1B1A]">
                  {/* Message Body with truncation if long (only if text exists) */}
                  {message.content?.trim() ? (
                    <div className="relative min-w-0 max-w-full">
                      <p
                        className={`text-base font-normal text-stone-900 leading-relaxed whitespace-pre-line break-words [overflow-wrap:anywhere] ${
                          isLongContent && !isExpanded ? 'line-clamp-4 max-h-28 overflow-hidden' : ''
                        }`}
                      >
                        {renderUserMessageContent(message.content)}
                      </p>

                      {/* Show More / Show Less Toggle */}
                      {isLongContent && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(message.id)}
                          className="w-full mt-2 pt-1.5 flex items-center justify-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900 transition-colors border-t border-[#D9D6CF] cursor-pointer min-h-[32px] sm:min-h-0"
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
                ) : null}

                {message.content?.trim() ? (
                  <button
                    type="button"
                    onClick={() => handleCopy(message.id, message.content)}
                    className="mt-1 mr-1 inline-flex h-7 w-7 items-center justify-center text-zinc-400 hover:text-zinc-700 active:text-[#1C1B1A] transition-colors cursor-pointer"
                    aria-label={copiedId === message.id ? 'Copied' : 'Copy message'}
                    title={copiedId === message.id ? 'Copied' : 'Copy'}
                  >
                    {copiedId === message.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : null}

                {/* Inline Failed Turn State: Active failure (with Try again button) */}
                {failedTurn && failedTurn.uiMessageId === message.id ? (
                  <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 px-3.5 py-2.5 sm:py-2 mt-2.5 rounded-xl bg-[#EFEDE9]/90 border border-[#D9D6CF] text-xs text-stone-600 animate-in fade-in duration-150 max-w-full min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="font-normal text-stone-700 truncate">Something went wrong.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRetryTurn && onRetryTurn(failedTurn)}
                      disabled={isDebating}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-stone-50 active:bg-stone-200/70 border border-[#D9D6CF] text-stone-800 text-xs font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 min-h-[32px] sm:min-h-0 flex items-center"
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
        const activityRingColor =
          modelKey === 'claude'
            ? '#EA8A75'
            : modelKey === 'gemini'
              ? '#82A7EC'
              : '#858589';

        // Gap calculation:
        // - Larger noticeable gap following a user message (User -> Model)
        // - Smaller cohesive gap following another model response (Model -> Model)
        const spacingClass =
          viewMode === 'side-by-side'
            ? 'mt-0'
            : shouldShowDate || idx === 0
              ? 'mt-0'
              : isPrevUser
                ? 'mt-7 sm:mt-8'
                : 'mt-4 sm:mt-[18px]';

        const isThinking = message.isStreaming && !message.content.trim();
        const forceRevealOnMount = freshModelMessageIds.has(message.id);
        const isVisuallyRevealing =
          revealingMessageIds.has(message.id) || forceRevealOnMount;
        const activeSeatIndex = orderedActiveModels.indexOf(modelKey);
        const upNextModels =
          isThinking && activeSeatIndex >= 0
            ? orderedActiveModels.slice(activeSeatIndex + 1)
            : [];
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
        const isAiCollapsible =
          !message.isStreaming &&
          (
            message.content.length > 280 ||
            message.content.split('\n').length > 5 ||
            attachments.length > 0
          );
        const isAiCollapsed =
          isAiCollapsible && Boolean(collapsedAiMsgIds[message.id]);

        return (
          <React.Fragment key={message.id}>
            {shouldShowDate && formattedDate && (
              <div
                className={`col-span-full flex justify-center select-none ${
                  idx === 0 ? 'mb-4' : 'mt-6 mb-4'
                }`}
              >
                <span className="text-xs font-normal text-[#8A867D]">
                  {formattedDate}
                </span>
              </div>
            )}
            <div
              id={message.id}
              className={`scroll-mt-6 sm:scroll-mt-8 w-full max-w-full min-w-0 ${spacingClass} ${
                viewMode === 'side-by-side'
                  ? 'rounded-2xl border border-[#E7E5E0] bg-white p-4'
                  : 'bg-transparent'
              }`}
            >
              <div
                className={`grid gap-x-3 min-w-0 ${
                  viewMode === 'side-by-side'
                    ? 'grid-cols-[32px_minmax(0,1fr)]'
                    : 'grid-cols-[44px_minmax(0,1fr)]'
                }`}
              >
                <div
                  className={`relative row-span-3 shrink-0 ${
                    viewMode === 'side-by-side' ? 'h-8 w-8' : 'h-11 w-11'
                  }`}
                >
                  {message.isStreaming && (
                    <span
                      className="plurilog-thinking-ring absolute -inset-[1.5px] rounded-full"
                      style={{
                        background: `conic-gradient(from 0deg, transparent 0deg 292deg, ${activityRingColor} 292deg 344deg, transparent 344deg 360deg)`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <ProviderBadge
                    provider={modelKey}
                    size={viewMode === 'side-by-side' ? 'md' : 'lg'}
                    showBorder={false}
                    className="relative z-[1]"
                  />
                </div>

                <div className="col-start-2 flex items-baseline gap-2 min-w-0 mb-1">
                  <span className="font-semibold text-[14px] text-[#1C1B1A] truncate">
                    {member.name}
                  </span>
                  <span className="text-[12px] text-[#8A867D] shrink-0">
                    {message.timestamp}
                  </span>
                </div>

              {/* Message Body */}
              <div className="col-start-2 min-w-0">
              {isThinking ? (
                <div className="flex min-w-0 flex-col items-start">
                  <SeatActivityIndicator
                    provider={modelKey}
                    status={seatStatuses[modelKey] || 'thinking'}
                    startedAt={message.createdAt}
                    searchSources={seatSearchSources[modelKey] || []}
                    activityLabel={seatActivityLabels[modelKey] || null}
                    reduceMotion={Boolean(shouldReduceMotion)}
                  />
                  {upNextModels.length > 0 && (
                    <motion.div
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: 'easeOut' }}
                      className="mt-2 inline-flex items-center gap-2 text-[12px] text-[#6A675F]"
                    >
                      <span className="flex -space-x-1.5" aria-hidden="true">
                        {upNextModels.map((id) => (
                          <ProviderBadge
                            key={id}
                            provider={id}
                            size="sm"
                          />
                        ))}
                      </span>
                      <span>
                        {upNextModels.map((id) => COUNCIL_MEMBERS[id]?.name || id).join(
                          upNextModels.length === 2 ? ' and ' : ', '
                        )}{' '}
                        {upNextModels.length === 1 ? 'is' : 'are'} up next
                      </span>
                    </motion.div>
                  )}
                </div>
              ) : (
                <motion.div
                  initial={false}
                  animate={{ height: isAiCollapsed ? 82 : 'auto' }}
                  transition={{
                    duration: shouldReduceMotion ? 0 : 0.28,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="relative min-w-0 max-w-full overflow-hidden"
                >
                  <div className={isAiCollapsed ? 'pointer-events-none' : ''}>
                    <StreamingMessageBody
                      content={message.content}
                      isStreaming={message.isStreaming}
                      reduceMotion={Boolean(shouldReduceMotion)}
                      forceRevealOnMount={forceRevealOnMount}
                      onRevealStateChange={(isRevealing) =>
                        handleRevealStateChange(message.id, isRevealing)
                      }
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
                              className="w-20 h-20 sm:w-28 sm:h-28 rounded-[24px] overflow-hidden border border-zinc-200/90 bg-zinc-100 block cursor-pointer hover:opacity-90 transition-opacity shrink-0"
                              title={`Click to view ${filename}`}
                            >
                              <img
                                src={url}
                                alt={filename}
                                className="w-full h-full object-cover"
                              />
                            </button>
                            <span
                              className="text-[10px] sm:text-[11px] font-mono text-[#6A675F] hover:text-zinc-700 max-w-[80px] sm:max-w-[112px] truncate px-1 text-center select-all"
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
                    <div className="mt-3 flex w-full max-w-[330px] flex-col gap-2 min-w-0">
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
                        const documentTypeLabel = isPdfDocument
                          ? 'PDF document'
                          : isDocxDocument
                            ? 'Word document'
                            : isTextDocument
                              ? `${documentBadge} document`
                              : 'Document';
                        const documentIconSrc = isPdfDocument
                          ? '/file-icon-pdf.svg'
                          : isDocxDocument
                            ? '/file-icon-docx.svg'
                            : null;
                        const fallbackBadgeClass = isTextDocument
                          ? 'bg-[#4F8A68]'
                          : 'bg-[#6A675F]';

                        const openPreview = () =>
                          onPreviewDocument?.({ url, filename });

                        return (
                          <div
                            key={`${url}-doc-${i}`}
                            role="button"
                            tabIndex={0}
                            onClick={openPreview}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openPreview();
                              }
                            }}
                            className="group flex min-h-[64px] w-full cursor-pointer items-center gap-3 rounded-[12px] border border-[#E2E0DB] bg-white px-2.5 py-2 transition-colors hover:border-[#D9D6CF] hover:bg-[#F7F6F3] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D9D6CF]"
                            title={`Preview ${filename}`}
                            aria-label={`Preview ${filename}`}
                          >
                            <div className="flex h-14 w-11 shrink-0 items-center justify-center">
                              {documentIconSrc ? (
                                <img
                                  src={documentIconSrc}
                                  alt=""
                                  className="h-14 w-11 object-contain"
                                  aria-hidden="true"
                                />
                              ) : (
                                <div className="relative flex h-11 w-9 items-center justify-center">
                                  <FileText className="h-10 w-10 text-[#B7B3AA]" />
                                  <span
                                    className={`absolute bottom-0 left-1/2 -translate-x-1/2 rounded-[3px] px-1 py-[1px] text-[7px] font-semibold leading-none tracking-[0.04em] text-white ${fallbackBadgeClass}`}
                                  >
                                    {documentBadge}
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <p
                                className="line-clamp-2 break-all text-[12px] font-medium leading-[15px] text-[#1C1B1A]"
                                title={filename}
                              >
                                {filename}
                              </p>
                              <p className="mt-1 text-[10px] leading-4 text-[#6A675F]">
                                {documentTypeLabel}
                              </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openPreview();
                                }}
                                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] border border-[#E2E0DB] bg-white text-[#6A675F] transition-colors hover:bg-[#EFEDE9] hover:text-[#1C1B1A]"
                                title={`Preview ${filename}`}
                                aria-label={`Preview ${filename}`}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <a
                                href={url}
                                download={filename}
                                onClick={(event) => event.stopPropagation()}
                                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] border border-[#E2E0DB] bg-white text-[#6A675F] transition-colors hover:bg-[#EFEDE9] hover:text-[#1C1B1A]"
                                title={`Download ${filename}`}
                                aria-label={`Download ${filename}`}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  </div>

                  <AnimatePresence initial={false}>
                    {isAiCollapsed && (
                      <motion.div
                        key="collapsed-fade"
                        initial={shouldReduceMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-b from-[#F7F6F3]/0 via-[#F7F6F3]/80 to-[#F7F6F3]"
                        aria-hidden="true"
                      />
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              </div>

              {/* Bottom Actions Bar: Copy, Export & Collapse (Rendered once content exists) */}
              {!isThinking && !isVisuallyRevealing && (
                <div className="col-start-2 mt-2 flex items-center justify-between gap-2 text-xs min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                      onClick={() => handleCopy(message.id, message.content)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-[#6A675F] hover:text-[#1C1B1A] hover:bg-[#EFEDE9] transition-colors cursor-pointer target-secondary"
                      title={`Copy ${member.name}'s reply`}
                aria-label={`Copy ${member.name}'s reply`}
                    >
                      {copiedId === message.id ? (
                        <Check className="w-4 h-4 text-[#F2C94C] shrink-0" />
                      ) : (
                        <Copy className="w-4 h-4 shrink-0" />
                      )}
                    </button>

                    {onExportMessage && (
                      <button
                        type="button"
                        onClick={() => onExportMessage(message)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-[#6A675F] hover:text-[#1C1B1A] hover:bg-[#EFEDE9] transition-colors cursor-pointer target-secondary"
                        title="Download response as PDF"
                        aria-label="Download response as PDF"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {isAiCollapsible && (
                    <button
                      type="button"
                      onClick={() => toggleAiCollapse(message.id)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-[#6A675F] hover:text-[#1C1B1A] hover:bg-[#EFEDE9] transition-colors cursor-pointer target-secondary"
                      title={isAiCollapsed ? 'Expand response' : 'Collapse response'}
                      aria-label={isAiCollapsed ? 'Expand response' : 'Collapse response'}
                      aria-expanded={!isAiCollapsed}
                    >
                      {isAiCollapsed ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronUp className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              )}
              </div>
            </div>
          </React.Fragment>
        );
      })}

      {/* Continue discussion appears only after the final visible answer has settled. */}
      {canContinue &&
        !isDebating &&
        revealingMessageIds.size === 0 &&
        freshModelMessageIds.size === 0 &&
        messages.length > 0 &&
        onContinue &&
        (() => {
        const lastUserIndex = [...messages]
          .map((item, index) => ({ item, index }))
          .reverse()
          .find(({ item }) => item.role === 'user')?.index ?? -1;

        const latestModels = Array.from(
          new Set(
            messages
              .slice(lastUserIndex + 1)
              .filter((item) => item.role === 'model' && item.content.trim())
              .map((item) => {
                const raw = String(item.modelId || item.authorName || '').toLowerCase();
                if (raw.includes('claude') || raw.includes('anthropic')) return 'claude';
                if (raw.includes('chatgpt') || raw.includes('gpt') || raw.includes('openai')) return 'chatgpt';
                return 'gemini';
              })
          )
        ) as ModelId[];

        if (latestModels.length === 0) return null;

        const expectedAnswers = Math.max(1, activeModels.length);
        const answerLabel =
          latestModels.length >= expectedAnswers
            ? `All ${latestModels.length} answered`
            : `${latestModels.length} of ${expectedAnswers} answered`;

        return (
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.24,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="col-span-full pt-6 pb-2 min-w-0"
          >
            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-[#E7E5E0]" />
              <span className="text-[14px] text-[#6A675F] whitespace-nowrap">
                {answerLabel}
              </span>
              <button
                type="button"
                onClick={onContinue}
                className="h-10 inline-flex items-center gap-2 rounded-full bg-[#1C1B1A] hover:bg-[#2A2927] px-4 text-white text-[14px] font-medium transition-colors cursor-pointer shrink-0"
                title="Let them keep discussing"
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Let them keep discussing</span>
              </button>
              <div className="h-px flex-1 bg-[#E7E5E0]" />
            </div>
          </motion.div>
        );
      })()}

      {/* Dynamic bottom spacer: untransitioned/instant height change so scrollHeight is immediately accurate during deliberation */}
      <div className={`col-span-full w-full shrink-0 ${isDebating ? 'h-[50vh]' : 'h-0'}`} />

      {/* Invisible anchor for auto-scroll on discussion load */}
      <div ref={bottomRef} className="col-span-full h-1 w-full" />

      {/* Image Lightbox Modal */}
      <ImageLightbox
        isOpen={!!lightboxImageUrl}
        onClose={() => setLightboxImageUrl(null)}
        imageUrl={lightboxImageUrl}
      />
    </div>
  );
};
