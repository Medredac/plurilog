'use client';

import React, { useState, useRef, useEffect } from 'react';
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
  FileText
} from 'lucide-react';
import { ChatMessage, ModelId, SeatStatus } from '../types/chat';
import { COUNCIL_MEMBERS } from '../data/mockDebates';
import { ImageLightbox } from './ImageLightbox';

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
    <div className="relative my-3 rounded-xl border border-zinc-200/80 bg-[#f8f8f8] overflow-hidden shadow-2xs group text-left">
      {/* Top Header Bar with Language tag and Copy Button (Neutral light grey styling) */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#f4f4f4] border-b border-zinc-200/70 text-zinc-500">
        <span className="text-[11px] font-mono font-medium lowercase tracking-wide text-zinc-500">
          {language !== 'text' ? language : 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200/70 transition-colors cursor-pointer"
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
      <div className="overflow-x-auto bg-[#f8f8f8]">
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
          className="font-mono text-[0.875em] bg-zinc-100 text-zinc-800 px-1.5 py-0.5 rounded-md border border-zinc-200/60 font-normal"
          {...props}
        >
          {children}
        </code>
      );
    }

    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  p: ({ children }) => (
    <p className="text-base sm:text-[16.5px] text-zinc-800 leading-relaxed font-normal mb-3 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-2.5 pl-5 list-disc space-y-1 text-zinc-800 text-base sm:text-[16.5px]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 pl-5 list-decimal space-y-1 text-zinc-800 text-base sm:text-[16.5px]">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed text-zinc-800 text-base sm:text-[16.5px]">
      {children}
    </li>
  ),
  h1: ({ children }) => (
    <h1 className="font-semibold text-lg sm:text-xl text-zinc-900 mt-4 mb-2">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-semibold text-base sm:text-lg text-zinc-900 mt-3.5 mb-1.5">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-semibold text-sm sm:text-base text-zinc-900 mt-3 mb-1">
      {children}
    </h3>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-zinc-900">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-amber-300 pl-3.5 my-2.5 italic text-zinc-600">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-amber-800 hover:text-amber-900 underline underline-offset-2 transition-colors"
    >
      {children}
    </a>
  ),
};

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

        if (message.role === 'user' && message.content === 'Continue') {
          return (
            <div
              id={message.id}
              key={message.id}
              className={`flex justify-end scroll-mt-6 sm:scroll-mt-8 ${idx === 0 ? 'mt-0' : 'mt-10 sm:mt-12'}`}
            >
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 text-zinc-400">
                <CornerDownRight className="w-3.5 h-3.5" />
              </div>
            </div>
          );
        }

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
              <div className="max-w-3xl bg-stone-100 rounded-xl p-4.5 shadow-sm relative">
                <div className="flex items-center justify-between gap-4 mb-1.5 text-xs text-stone-500">
                  <span className="font-semibold text-zinc-700">{message.authorName || 'You'}</span>
                  <span className="text-[10px] font-mono text-stone-400">{message.timestamp}</span>
                </div>

                {/* Attached File Thumbnail (Image or PDF) if present */}
                {message.image_url && (
                  message.image_url.split('?')[0].toLowerCase().endsWith('.pdf') ? (
                    <button
                      type="button"
                      onClick={() => window.open(message.image_url!, '_blank')}
                      className="mb-2.5 w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-stone-200/80 transition-colors p-2"
                      title="Click to view PDF in new tab"
                    >
                      <FileText className="w-7 h-7 sm:w-8 sm:h-8 text-red-500" />
                      <span className="text-[10px] sm:text-xs font-semibold text-zinc-600 uppercase tracking-wider bg-white/80 px-2 py-0.5 rounded border border-stone-200/60">
                        PDF
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLightboxImageUrl(message.image_url!)}
                      className="mb-2.5 w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-stone-200/90 bg-stone-200/50 shadow-2xs block cursor-pointer hover:opacity-90 transition-opacity"
                      title="Click to view full image"
                    >
                      <img
                        src={message.image_url}
                        alt="Attached image"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  )
                )}

                {/* Message Body with truncation if long */}
                <div className="relative">
                  <p
                    className={`text-base font-normal text-stone-900 leading-relaxed whitespace-pre-line break-words ${
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

        // Gap calculation:
        // - Larger noticeable gap following a user message (User -> Model)
        // - Smaller cohesive gap following another model response (Model -> Model)
        const spacingClass = idx === 0 
          ? 'mt-0' 
          : isPrevUser 
            ? 'mt-7 sm:mt-8' 
            : 'mt-3.5 sm:mt-4';

        const isThinking = message.isStreaming && !message.content.trim();

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
                <span className="font-semibold text-xs text-zinc-700">
                  {member.name}
                </span>
              </div>

              <span className="text-[10px] font-mono text-zinc-400">
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
              /* Message Body with real ReactMarkdown rendering */
              <div className="text-base sm:text-[16.5px] text-zinc-800 leading-relaxed font-normal">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {message.content}
                </ReactMarkdown>
                {message.isStreaming && (
                  <span className="inline-block w-1.5 h-4 bg-amber-500 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            )}

            {/* Bottom Actions Bar: Copy Only (Rendered once content exists) */}
            {!isThinking && (
              <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
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
            )}
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
            <span>Let them keep discussing</span>
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
