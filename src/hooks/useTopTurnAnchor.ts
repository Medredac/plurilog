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
  tailTopOffsetMobile = 24,
  tailTopOffsetDesktop = 32,
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

    if (!viewport || !content || !reserve || !anchorId) {
      if (reserve) reserve.style.height = '0px';
      lastTargetScrollTopRef.current = null;
      if (!anchorId) lastScrolledAnchorIdRef.current = null;
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

      // Also guarantee enough scroll range for the currently presenting AI
      // seat to be manually brought to the same comfortable reading position.
      // This does not auto-follow the seat; it only makes that position
      // physically reachable. As the response grows beneath it, the reserve
      // naturally shrinks.
      const requiredTailReserve = tailAnchor
        ? Math.max(
            0,
            getLayoutOffsetTop(tailAnchor, viewport) -
              tailTopOffset +
              viewport.clientHeight -
              baseScrollHeight
          )
        : 0;

      const nextReserve = Math.ceil(
        Math.max(requiredAnchorReserve, requiredTailReserve)
      );

      if (Math.abs(reserve.offsetHeight - nextReserve) > 1) {
        reserve.style.height = `${nextReserve}px`;
        schedule();
        return;
      }

      const previousTarget = lastTargetScrollTopRef.current;
      const isNewAnchor = lastScrolledAnchorIdRef.current !== anchorId;

      if (isNewAnchor) {
        if (Math.abs(viewport.scrollTop - targetScrollTop) > 1) {
          viewport.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth',
          });
        }
        lastScrolledAnchorIdRef.current = anchorId;
      } else if (
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
