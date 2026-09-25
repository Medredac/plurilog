'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Minus,
  PanelLeftClose,
  Plus,
} from 'lucide-react';

interface PreviewPage {
  pageNumber: number;
  url: string;
}

interface PreviewResponse {
  filename: string;
  totalPageCount: number | null;
  renderedPageCount: number;
  truncated: boolean;
  pages: PreviewPage[];
}

interface ResponsiveDocumentViewerProps {
  documentUrl: string;
  filename: string;
  fallbackPreviewUrl: string | null;
}

function getPreviewPagesUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const attachmentPrefix = '/api/attachments/';
    if (!parsed.pathname.startsWith(attachmentPrefix)) return null;

    parsed.pathname = parsed.pathname.replace(
      attachmentPrefix,
      '/api/document-preview-pages/'
    );
    parsed.hash = '';

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export const ResponsiveDocumentViewer: React.FC<
  ResponsiveDocumentViewerProps
> = ({ documentUrl, filename, fallbackPreviewUrl }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);

  const previewPagesUrl = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return getPreviewPagesUrl(documentUrl);
  }, [documentUrl]);

  useEffect(() => {
    if (!previewPagesUrl) {
      setLoading(false);
      setPreview(null);
      setPreviewError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setPreview(null);
    setPreviewError(null);
    setCurrentPage(1);
    setZoom(1);

    fetch(previewPagesUrl, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Preview failed with status ${response.status}`);
        }
        return (await response.json()) as PreviewResponse;
      })
      .then((data) => {
        if (!Array.isArray(data.pages) || data.pages.length === 0) {
          throw new Error('Preview returned no pages.');
        }
        setPreview(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('[Document Viewer] Page preview failed', error);
        setPreviewError('The responsive preview could not be prepared.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [previewPagesUrl]);

  const updateCurrentPage = () => {
    const scroller = scrollRef.current;
    if (!scroller || !preview?.pages.length) return;

    const targetY = scroller.getBoundingClientRect().top + 52;
    let closestPage = currentPage;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const page of preview.pages) {
      const element = pageRefs.current[page.pageNumber];
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const distance = Math.abs(rect.top - targetY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = page.pageNumber;
      }
    }

    setCurrentPage(closestPage);
  };

  const goToPage = (pageNumber: number) => {
    const target = pageRefs.current[pageNumber];
    if (!target) return;

    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    setCurrentPage(pageNumber);
  };

  const pageCount =
    preview?.totalPageCount || preview?.renderedPageCount || preview?.pages.length || 0;

  if (!previewPagesUrl) {
    return fallbackPreviewUrl ? (
      <iframe
        src={fallbackPreviewUrl}
        title={`Preview of ${filename}`}
        className="h-full w-full border-0 bg-white"
      />
    ) : (
      <div className="flex h-full items-center justify-center p-6 text-sm text-zinc-500">
        Preview unavailable.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-100">
        <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-500 shadow-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Preparing responsive preview…
        </div>
      </div>
    );
  }

  if (!preview || previewError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-100 p-6 text-center">
        <p className="text-sm text-zinc-600">
          {previewError || 'Preview unavailable.'}
        </p>
        {fallbackPreviewUrl && (
          <a
            href={fallbackPreviewUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Open native preview
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-200">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-zinc-700 bg-zinc-800 px-2.5 text-zinc-100">
        <button
          type="button"
          onClick={() => setThumbnailsOpen((current) => !current)}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
            thumbnailsOpen
              ? 'bg-white/15 text-white'
              : 'text-zinc-300 hover:bg-white/10 hover:text-white'
          }`}
          title={thumbnailsOpen ? 'Hide page thumbnails' : 'Show page thumbnails'}
          aria-label={thumbnailsOpen ? 'Hide page thumbnails' : 'Show page thumbnails'}
          aria-pressed={thumbnailsOpen}
        >
          <PanelLeftClose
            className={`h-4 w-4 transition-transform ${
              thumbnailsOpen ? '' : 'rotate-180'
            }`}
          />
        </button>

        <div className="mx-1 h-5 w-px bg-white/15" />

        <span className="min-w-[64px] text-center text-xs font-medium tabular-nums text-zinc-200">
          {currentPage} / {pageCount}
        </span>

        <div className="mx-1 h-5 w-px bg-white/15" />

        <button
          type="button"
          onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))}
          disabled={zoom <= 0.7}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-30"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setZoom(1)}
          className="min-w-[70px] rounded-md px-2 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
          title="Fit page to available width"
        >
          {zoom === 1 ? 'Fit width' : `${Math.round(zoom * 100)}%`}
        </button>

        <button
          type="button"
          onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
          disabled={zoom >= 1.6}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-30"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>

        <span className="ml-auto hidden truncate text-[10px] text-zinc-400 sm:block">
          Resizes with the panel
        </span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={`shrink-0 overflow-hidden bg-zinc-900 transition-[width] duration-200 ease-out ${
            thumbnailsOpen ? 'w-[150px] sm:w-[170px]' : 'w-0'
          }`}
          aria-hidden={!thumbnailsOpen}
        >
          <div className="h-full w-[150px] overflow-y-auto px-3 py-3 sm:w-[170px]">
            <div className="space-y-3">
              {preview.pages.map((page) => (
                <button
                  key={`thumb-${page.pageNumber}`}
                  type="button"
                  onClick={() => goToPage(page.pageNumber)}
                  className="block w-full"
                  tabIndex={thumbnailsOpen ? 0 : -1}
                  aria-label={`Go to page ${page.pageNumber}`}
                >
                  <div
                    className={`overflow-hidden rounded-sm border-2 bg-white transition-colors ${
                      currentPage === page.pageNumber
                        ? 'border-blue-400'
                        : 'border-transparent hover:border-zinc-500'
                    }`}
                  >
                    <img
                      src={page.url}
                      alt=""
                      className="block h-auto w-full"
                      draggable={false}
                    />
                  </div>
                  <span className="mt-1.5 block text-center text-[10px] tabular-nums text-zinc-300">
                    {page.pageNumber}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={updateCurrentPage}
          className="min-w-0 flex-1 overflow-auto bg-zinc-200"
        >
          <div className="flex min-h-full w-full flex-col items-center gap-4 px-3 py-4 sm:px-4">
            {preview.pages.map((page) => (
              <div
                key={`page-${page.pageNumber}`}
                ref={(element) => {
                  pageRefs.current[page.pageNumber] = element;
                }}
                className="scroll-mt-4 shrink-0"
                style={{
                  width: `calc((100% - 8px) * ${zoom})`,
                  minWidth: zoom > 1 ? `${Math.round(zoom * 100)}%` : undefined,
                }}
              >
                <img
                  src={page.url}
                  alt={`Page ${page.pageNumber} of ${filename}`}
                  className="block h-auto w-full bg-white shadow-sm"
                  draggable={false}
                />
              </div>
            ))}

            {preview.truncated && (
              <div className="mb-4 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-center text-xs text-zinc-500">
                Preview shows the first {preview.renderedPageCount} pages.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
