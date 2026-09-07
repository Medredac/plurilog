"use client";

import React from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ChatMessage, ModelId } from "../types/chat";
import { COUNCIL_MEMBERS } from "../data/mockDebates";
import { getAttachmentDisplayFilename } from "./ChatFeed";

interface ParsedSource {
  title: string;
  url: string;
}

interface ParsedMessageSources {
  mainContent: string;
  sources: ParsedSource[] | null;
}

function parseTrailingSources(rawContent: string): ParsedMessageSources {
  if (!rawContent || typeof rawContent !== "string") {
    return { mainContent: rawContent || "", sources: null };
  }
  const marker = "\n\nSources:\n";
  const lastIndex = rawContent.lastIndexOf(marker);
  if (lastIndex === -1) {
    return { mainContent: rawContent, sources: null };
  }
  const potentialMain = rawContent.slice(0, lastIndex);
  const potentialSourcesBlock = rawContent.slice(lastIndex + marker.length).trim();
  const lines = potentialSourcesBlock.split("\n").map((l) => l.trim()).filter(Boolean);
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
    const cleanTitle = itemMatch[1].replace(/\\([\[\]\\])/g, "$1").trim();
    parsedSources.push({
      title: cleanTitle || "Source",
      url: itemMatch[2].trim(),
    });
  }
  return {
    mainContent: potentialMain,
    sources: parsedSources,
  };
}

const conversationDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function getLocalDayKey(dateInput?: string): string {
  if (!dateInput) return "";
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function formatConversationDate(dateInput?: string): string {
  if (!dateInput) return "";
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  return conversationDateFormatter.format(d);
}

const printMarkdownComponents: Partial<Components> = {
  p: ({ children }) => (
    <p className="mb-3 leading-relaxed text-zinc-900 text-sm font-normal break-words">
      {children}
    </p>
  ),
  h1: ({ children }) => (
    <h1 className="text-lg font-bold text-zinc-900 mt-4 mb-2 pb-1 border-b border-zinc-200 print-avoid-break-after">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-bold text-zinc-900 mt-3 mb-1.5 pb-0.5 border-b border-zinc-200 print-avoid-break-after">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-zinc-900 mt-2.5 mb-1 print-avoid-break-after">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-3 space-y-1 text-sm text-zinc-900">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-3 space-y-1 text-sm text-zinc-900">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-zinc-300 pl-3 my-2.5 text-zinc-600 italic text-sm">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-700 underline font-medium break-all"
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || "");
    const isInline = !match && !String(children).includes("\n");
    if (isInline) {
      return (
        <code
          className="bg-zinc-100 text-zinc-800 text-xs px-1.5 py-0.5 rounded font-mono border border-zinc-200"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <div className="my-3 rounded-lg overflow-hidden border border-zinc-200 bg-zinc-50 text-xs font-mono print-avoid-break">
        <SyntaxHighlighter
          language={match ? match[1] : "text"}
          style={oneLight}
          customStyle={{
            margin: 0,
            padding: "12px",
            backgroundColor: "#f8fafc",
            fontSize: "12px",
            lineHeight: "1.5",
          }}
          wrapLongLines={true}
        >
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      </div>
    );
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto border border-zinc-200 rounded-lg print-avoid-break">
      <table className="min-w-full divide-y divide-zinc-200 text-xs text-left">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-zinc-50 font-semibold text-zinc-700">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-zinc-100 bg-white">{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 text-zinc-700">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 text-zinc-800">{children}</td>,
  hr: () => <hr className="my-4 border-zinc-200" />,
};

interface PrintableDiscussionProps {
  mode: "discussion" | "message";
  messages: ChatMessage[];
  discussionTitle: string;
}

export const PrintableDiscussion: React.FC<PrintableDiscussionProps> = ({
  mode,
  messages,
  discussionTitle,
}) => {
  const exportTimestamp = new Date().toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div id="plurilog-print-root" className="hidden print:block bg-white text-zinc-900 font-sans p-0 m-0">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          @page {
            margin: 15mm;
            size: auto;
          }
          body {
            background-color: #ffffff !important;
            color: #18181b !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-avoid-break {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .print-avoid-break-after {
            break-after: avoid !important;
            page-break-after: avoid !important;
          }
        }
      `,
        }}
      />

      {/* Document Header */}
      <header className="pb-4 mb-6 border-b border-zinc-300 print-avoid-break print-avoid-break-after">
        <div className="flex items-center justify-between gap-4 mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-zinc-900">PLURILOG</span>
            <span className="text-xs uppercase tracking-wider font-semibold text-zinc-400">
              {mode === "discussion" ? "Council Deliberation" : "AI Response"}
            </span>
          </div>
          <span className="text-xs text-zinc-500 font-medium">{exportTimestamp}</span>
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 tracking-tight leading-snug">
          {discussionTitle}
        </h1>
      </header>

      {/* Transcript Sequence */}
      <div className="space-y-6">
        {messages.map((message, idx) => {
          const prevMessage = idx > 0 ? messages[idx - 1] : null;
          const currentKey = getLocalDayKey(message.createdAt);
          const prevKey = prevMessage ? getLocalDayKey(prevMessage.createdAt) : "";
          const shouldShowDate =
            mode === "discussion" &&
            Boolean(currentKey) &&
            (idx === 0 || currentKey !== prevKey);
          const formattedDate = formatConversationDate(message.createdAt);

          const isUser = message.role === "user";
          let modelKey: ModelId = "gemini";
          if (message.modelId) {
            const lower = String(message.modelId).toLowerCase();
            if (lower.includes("claude") || lower.includes("anthropic")) modelKey = "claude";
            else if (lower.includes("chatgpt") || lower.includes("gpt") || lower.includes("openai")) modelKey = "chatgpt";
            else modelKey = "gemini";
          }
          const authorName = isUser
            ? (message.authorName || "You")
            : (message.authorName || COUNCIL_MEMBERS[modelKey]?.name || "AI");

          const { mainContent, sources } = parseTrailingSources(message.content);

          const attachments: string[] =
            message.attachment_urls && message.attachment_urls.length > 0
              ? message.attachment_urls
              : message.image_url
                ? [message.image_url]
                : [];

          return (
            <React.Fragment key={message.id || idx}>
              {/* Day separator: Plain centered muted text without bubble/pill background */}
              {shouldShowDate && formattedDate && (
                <div className="text-center py-2 my-2 print-avoid-break print-avoid-break-after">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                    {formattedDate}
                  </span>
                </div>
              )}

              {/* Transcript Turn (Natural pagination enabled, no card/bubble wrapper) */}
              <div className="pb-6 border-b border-zinc-100 last:border-b-0">
                {/* Author + Timestamp Heading */}
                <div className="flex items-center justify-between gap-2 mb-2 pb-1 border-b border-zinc-200 text-xs print-avoid-break print-avoid-break-after">
                  <span className="font-bold text-zinc-900 uppercase tracking-wider">
                    {authorName}
                  </span>
                  <div className="text-zinc-500 font-mono text-[11px] flex items-center gap-1.5">
                    {mode === 'message' && formattedDate && (
                      <span>{formattedDate}</span>
                    )}
                    {mode === 'message' && formattedDate && message.timestamp && (
                      <span>·</span>
                    )}
                    {message.timestamp && <span>{message.timestamp}</span>}
                  </div>
                </div>

                {/* Attachments Metadata */}
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3 print-avoid-break">
                    {attachments.map((url, i) => {
                      const filename = getAttachmentDisplayFilename(url);
                      return (
                        <div
                          key={i}
                          className="px-2 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-700 text-xs font-mono flex items-center gap-1.5"
                        >
                          <span className="text-zinc-400 text-[10px]">Attached:</span>
                          <span>{filename}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Markdown Content (Paginates naturally across pages) */}
                {mainContent ? (
                  <div className="text-zinc-900 text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={printMarkdownComponents}>
                      {mainContent}
                    </ReactMarkdown>
                  </div>
                ) : null}

                {/* Web Sources / Citations */}
                {sources && sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-zinc-200">
                    <span className="text-xs font-bold text-zinc-700 block mb-1.5 print-avoid-break-after">
                      Sources & Citations:
                    </span>
                    <ol className="list-decimal pl-4 space-y-1 text-xs text-zinc-600">
                      {sources.map((src, sIdx) => (
                        <li key={sIdx} className="leading-normal">
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-700 underline hover:text-blue-900 font-medium"
                          >
                            {src.title}
                          </a>
                          <span className="text-zinc-400 font-mono text-[10px] ml-1.5">
                            ({src.url})
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Document Footer */}
      <footer className="mt-8 pt-4 border-t border-zinc-200 text-center text-xs text-zinc-400 print-avoid-break">
        Generated with Plurilog — The AI Council
      </footer>
    </div>
  );
};