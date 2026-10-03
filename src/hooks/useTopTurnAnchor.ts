'use client';

import { RefObject, useLayoutEffect, useRef } from 'react';

interface UseTopTurnAnchorOptions {
  viewportRef?: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  reserveRef: RefObject<HTMLDivElement | null>;
  anchorId: string | null;
  tailAnchorId?: string | null;
  topOffsetMobile?: number;
  tailTopOffsetMobile?: number;
  tailTopOffsetDesktop?: number;
  topOffsetDesktop?: number;
  autoScrollAnchor?: boolean;
  preserveScrollTop?: number | null;
  layoutVersion?: number;
  tallerThan?: number;
  visibleHeight?: number;
}

function getDocumentOffsetTop(element: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = element;

  while (current) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }

  return top;
}

function getLayoutOffsetTop(element: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = element;

  while (current && current !== ancestor) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }

  if (current === ancestor) return top;
  return getDocumentOffsetTop(element) - getDocumentOffsetTop(ancestor);
}

/**
 * Keeps the latest live user turn in a stable reading position near the top of
 * the chat viewport. The reserve element creates exactly the missing scroll
 * range needed to reach that position, then shrinks as responses grow.
 *
 * Geometry deliberately uses layout offsets rather than visual client rects so
 * Motion entrance transforms cannot move the scroll target while they settle.
 */
export function useTopTurnAnchor({
  viewportRef,
  contentRef,
  reserveRef,
  anchorId,
  tailAnchorId = null,
  topOffsetMobile = 24,
  topOffsetDesktop = 32,
  tailTopOffsetMobile = 64,
  tailTopOffsetDesktop = 80,
  autoScrollAnchor = true,
  preserveScrollTop = null,
  layoutVersion = 0,
  tallerThan = 176,
  visibleHeight = 104,
}: UseTopTurnAnchorOptions) {
  const lastScrolledAnchorIdRef = useRef<string | null>(null);
  const lastTargetScrollTopRef = useRef<number | null>(null);
  const lastObservedScrollTopRef = useRef(0);

  useLayoutEffect(() => {
    const viewport = viewportRef?.current;
    const content = contentRef.current;
    const reserve = reserveRef.current;

    if (!viewport || !content || !reserve) {
      return;
    }

    // A cancelled Continue turn must freeze the viewport: removing the
    // temporary round marker must never navigate back to prior content. Preserve enough tail
    // space to keep the exact scrollTop that existed when Stop was pressed.
    if (preserveScrollTop !== null) {
      viewport.style.overflowAnchor = 'none';

      const baseScrollHeight = Math.max(
        0,
        viewport.scrollHeight - reserve.offsetHeight
      );
      const requiredReserve = Math.max(
        0,
        preserveScrollTop + viewport.clientHeight - baseScrollHeight
      );

      reserve.style.height = `${Math.ceil(requiredReserve)}px`;
      viewport.scrollTop = preserveScrollTop;

      lastObservedScrollTopRef.current = preserveScrollTop;
      lastTargetScrollTopRef.current = null;
      if (!anchorId) lastScrolledAnchorIdRef.current = null;
      return;
    }

    viewport.style.overflowAnchor = '';

    if (!anchorId) {
      reserve.style.height = '0px';
      lastTargetScrollTopRef.current = null;
      lastScrolledAnchorIdRef.current = null;
      return;
    }

    const anchor = content.querySelector<HTMLElement>(
      `[data-turn-anchor-id="${CSS.escape(anchorId)}"]`
    );
    const tailAnchor = tailAnchorId
      ? content.querySelector<HTMLElement>(
          `[data-seat-anchor-id="${CSS.escape(tailAnchorId)}"]`
        )
      : null;

    if (!anchor) {
      reserve.style.height = '0px';
      return;
    }

    let frame: number | null = null;
    let disposed = false;

    const schedule = () => {
      if (disposed || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        apply();
      });
    };

    const apply = () => {
      if (disposed) return;

      const isDesktop = window.matchMedia('(min-width: 640px)').matches;
      const topOffset = isDesktop ? topOffsetDesktop : topOffsetMobile;
      const tailTopOffset = isDesktop
        ? tailTopOffsetDesktop
        : tailTopOffsetMobile;
      const anchorTop = getLayoutOffsetTop(anchor, viewport);
      const anchorHeight = anchor.offsetHeight;
      const visibleAnchorHeight =
        anchorHeight <= tallerThan ? anchorHeight : visibleHeight;

      const targetScrollTop = Math.max(
        0,
        Math.round(
          anchorTop +
            Math.max(0, anchorHeight - visibleAnchorHeight) -
            topOffset
        )
      );

      const baseScrollHeight = Math.max(
        0,
        viewport.scrollHeight - reserve.offsetHeight
      );
      const requiredAnchorReserve = Math.max(
        0,
        targetScrollTop + viewport.clientHeight - baseScrollHeight
      );

      // Reserve only what is required to hold the user turn at its intended
      // reading position. Do not add extra tail space for the active AI seat;
      // that created scrollable empty space below the natural conversation end.
      const nextReserve = Math.ceil(requiredAnchorReserve);

      if (Math.abs(reserve.offsetHeight - nextReserve) > 1) {
        reserve.style.height = `${nextReserve}px`;
        schedule();
        return;
      }

      const previousTarget = lastTargetScrollTopRef.current;
      const isNewAnchor = lastScrolledAnchorIdRef.current !== anchorId;

      if (isNewAnchor) {
        if (
          autoScrollAnchor &&
          Math.abs(viewport.scrollTop - targetScrollTop) > 1
        ) {
          viewport.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth',
          });
        }
        lastScrolledAnchorIdRef.current = anchorId;
      } else if (
        autoScrollAnchor &&
        previousTarget !== null &&
        Math.abs(lastObservedScrollTopRef.current - previousTarget) <= 2
      ) {
        // If layout above the live turn changes while the user is still pinned,
        // preserve the same anchor-relative position without a visible second
        // animation.
        const delta = targetScrollTop - previousTarget;
        if (Math.abs(delta) > 1) {
          viewport.scrollTo({
            top: Math.max(0, viewport.scrollTop + delta),
            behavior: 'auto',
          });
        }
      }

      lastTargetScrollTopRef.current = targetScrollTop;
      lastObservedScrollTopRef.current = viewport.scrollTop;
    };

    const onScroll = () => {
      lastObservedScrollTopRef.current = viewport.scrollTop;
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);
    resizeObserver.observe(anchor);
    if (tailAnchor) resizeObserver.observe(tailAnchor);

    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(content, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    viewport.addEventListener('scroll', onScroll, { passive: true });
    schedule();

    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener('scroll', onScroll);
    };
  }, [
    anchorId,
    tailAnchorId,
    autoScrollAnchor,
    preserveScrollTop,
    layoutVersion,
    contentRef,
    reserveRef,
    tallerThan,
    topOffsetDesktop,
    topOffsetMobile,
    tailTopOffsetDesktop,
    tailTopOffsetMobile,
    viewportRef,
    visibleHeight,
  ]);
}
