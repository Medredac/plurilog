'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  X,
} from 'lucide-react';

interface DocumentPreviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  documentUrl: string | null;
  filename: string | null;
}

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'html',
  'htm',
  'xml',
  'yaml',
  'yml',
]);

function getExtension(filename: string | null): string {
  if (!filename) return '';
  const clean = filename.split('?')[0].split('#')[0];
  const index = clean.lastIndexOf('.');
  return index === -1 ? '' : clean.slice(index + 1).toLowerCase();
}

function getInternalPreviewUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const attachmentPrefix = '/api/attachments/';
    if (!parsed.pathname.startsWith(attachmentPrefix)) return null;

    parsed.pathname = parsed.pathname.replace(
      attachmentPrefix,
      '/api/document-preview/'
    );
    parsed.hash = '';

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export const DocumentPreviewDrawer: React.FC<DocumentPreviewDrawerProps> = ({
  isOpen,
  onClose,
  documentUrl,
  filename,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [frameLoading, setFrameLoading] = useState(true);
  const [textLoading, setTextLoading] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isDocked, setIsDocked] = useState(false);
  const [dockedWidth, setDockedWidth] = useState(720);

  const extension = useMemo(() => getExtension(filename), [filename]);
  const isPdf = extension === 'pdf';
  const isDocx = extension === 'docx';
  const isText = TEXT_EXTENSIONS.has(extension);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia('(min-width: 1280px)');
    const updateLayout = () => {
      const docked = mq.matches;
      setIsDocked(docked);
      if (docked) {
        setDockedWidth(Math.min(Math.max(window.innerWidth * 0.42, 520), 760));
      }
    };

    updateLayout();
    mq.addEventListener?.('change', updateLayout);
    window.addEventListener('resize', updateLayout);

    return () => {
      mq.removeEventListener?.('change', updateLayout);
      window.removeEventListener('resize', updateLayout);
    };
  }, []);

  const previewUrl = useMemo(() => {
    if (!documentUrl || typeof window === 'undefined') return null;
    const internalPreview = getInternalPreviewUrl(documentUrl);

    if (isDocx || isText) return internalPreview;
    if (isPdf) return internalPreview || documentUrl;

    return null;
  }, [documentUrl, isDocx, isPdf, isText]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);

    if (!isDocked) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => closeButtonRef.current?.focus());

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = previousOverflow;
      };
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isDocked, onClose]);

  useEffect(() => {
    if (!isOpen || !isText || !previewUrl) {
      setTextContent(null);
      setTextLoading(false);
      return;
    }

    const controller = new AbortController();
    setTextLoading(true);
    setPreviewError(null);
    setTextContent(null);

    fetch(previewUrl, {
      credentials: 'same-origin',
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Preview failed with status ${response.status}`);
        }
        return response.text();
      })
      .then((text) => {
        setTextContent(text);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setPreviewError('This document could not be previewed.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setTextLoading(false);
      });

    return () => controller.abort();
  }, [isOpen, isText, previewUrl]);

  useEffect(() => {
    if (!isOpen) return;
    setFrameLoading(!isText && Boolean(previewUrl));
    setPreviewError(null);
  }, [isOpen, previewUrl, isText, documentUrl]);

  const badge = extension ? extension.toUpperCase() : 'FILE';
  const canPreview = Boolean(previewUrl) && (isPdf || isDocx || isText);

  const panelContent = documentUrl && filename ? (
    <>
      <header className="flex min-h-16 items-center gap-3 border-b border-zinc-200/80 bg-white px-3.5 py-3 sm:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
          <FileText
            className={`h-4.5 w-4.5 ${
              isPdf
                ? 'text-red-500'
                : isDocx
                  ? 'text-blue-600'
                  : 'text-zinc-600'
            }`}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-zinc-900">
              {filename}
            </h2>
            <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-zinc-500">
              {badge}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Document preview
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <a
            href={documentUrl}
            download={filename}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            title="Download document"
            aria-label="Download document"
          >
            <Download className="h-4 w-4" />
          </a>
          <a
            href={documentUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 sm:inline-flex"
            title="Open in new tab"
            aria-label="Open document in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
            title="Close preview"
            aria-label="Close document preview"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-zinc-100">
        {canPreview ? (
          isText ? (
            <div className="h-full overflow-auto px-3 py-4 sm:px-6 sm:py-6">
              <div className="mx-auto min-h-full max-w-4xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                {textLoading ? (
                  <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading preview…
                  </div>
                ) : previewError ? (
                  <div className="flex min-h-[50vh] items-center justify-center px-6 text-center text-sm text-zinc-500">
                    {previewError}
                  </div>
                ) : (
                  <pre className="min-h-full whitespace-pre-wrap break-words p-5 font-mono text-xs leading-6 text-zinc-700 sm:p-7 sm:text-[13px]">
                    {textContent}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <>
              {frameLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-100">
                  <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-xs text-zinc-500 shadow-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Preparing preview…
                  </div>
                </div>
              )}
              <iframe
                key={previewUrl}
                src={previewUrl || undefined}
                title={`Preview of ${filename}`}
                className="h-full w-full border-0 bg-white"
                onLoad={() => setFrameLoading(false)}
              />
            </>
          )
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-100">
                <FileText className="h-5 w-5 text-zinc-500" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-800">
                Preview unavailable
              </h3>
              <p className="mt-1.5 text-xs leading-5 text-zinc-500">
                This file type cannot be previewed here yet. You can still
                download it or open it in a new tab.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  ) : null;

  if (isDocked) {
    return (
      <AnimatePresence initial={false}>
        {isOpen && panelContent && (
          <motion.aside
            key="document-preview-docked"
            role="dialog"
            aria-label={`Preview ${filename}`}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: dockedWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.28,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="relative z-30 h-full shrink-0 overflow-hidden border-l border-zinc-200/80 bg-white shadow-[-12px_0_30px_-24px_rgba(0,0,0,0.35)]"
          >
            <div className="flex h-full min-w-[520px] flex-col bg-white">
              {panelContent}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && panelContent && (
        <div className="fixed inset-0 z-[90]" role="presentation">
          <motion.button
            type="button"
            aria-label="Close document preview"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
            className="absolute inset-0 bg-zinc-950/20 backdrop-blur-[1px] cursor-default"
          />

          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${filename}`}
            initial={{
              x: shouldReduceMotion ? 0 : '100%',
              opacity: shouldReduceMotion ? 1 : 0.96,
            }}
            animate={{ x: 0, opacity: 1 }}
            exit={{
              x: shouldReduceMotion ? 0 : '100%',
              opacity: shouldReduceMotion ? 1 : 0.98,
            }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.28,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl sm:w-[min(78vw,760px)] lg:w-[min(68vw,900px)]"
          >
            {panelContent}
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
};
