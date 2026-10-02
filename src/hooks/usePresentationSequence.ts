'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChatMessage } from '@/types/chat';

export type PresentationPhase = 'static' | 'queued' | 'active' | 'complete';

interface PresentationSequence {
  phaseFor: (messageId: string) => PresentationPhase;
  markComplete: (messageId: string) => void;
  activePresentationId: string | null;
  currentTurnModelIds: string[];
  hasCurrentTurnOutput: boolean;
  isCurrentTurnSettled: boolean;
}

/**
 * Presentation is deliberately independent from provider/network completion.
 *
 * The backend may already have completed later seats, but only one response is
 * allowed to present at a time. This makes visual order deterministic:
 * seat 1 -> seat 2 -> seat 3 -> turn controls.
 *
 * Completed message IDs are intentionally monotonic for the mounted thread.
 * Changing/cancelling a turn must never make an older response eligible to
 * animate again.
 */
export function usePresentationSequence(
  messages: ChatMessage[],
  turnUserId: string | null
): PresentationSequence {
  const [completedIds, setCompletedIds] = useState<Set<string>>(
    () => new Set()
  );

  const turnData = useMemo(() => {
    if (!turnUserId) {
      return {
        modelMessages: [] as ChatMessage[],
        modelIds: [] as string[],
      };
    }

    const userIndex = messages.findIndex(
      (message) => message.id === turnUserId && message.role === 'user'
    );

    if (userIndex === -1) {
      return {
        modelMessages: [] as ChatMessage[],
        modelIds: [] as string[],
      };
    }

    const modelMessages: ChatMessage[] = [];

    for (let index = userIndex + 1; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role === 'user') break;
      if (message.role === 'model') modelMessages.push(message);
    }

    return {
      modelMessages,
      modelIds: modelMessages.map((message) => message.id),
    };
  }, [messages, turnUserId]);

  const activePresentationId = useMemo(() => {
    for (const message of turnData.modelMessages) {
      const hasPayload =
        Boolean(message.isStreaming) ||
        Boolean(message.content.trim()) ||
        Boolean(message.attachment_urls?.length) ||
        Boolean(message.image_url);

      if (!completedIds.has(message.id) && hasPayload) {
        return message.id;
      }
    }
    return null;
  }, [completedIds, turnData.modelMessages]);

  const currentTurnModelSet = useMemo(
    () => new Set(turnData.modelIds),
    [turnData.modelIds]
  );

  const phaseFor = useCallback(
    (messageId: string): PresentationPhase => {
      if (!turnUserId || !currentTurnModelSet.has(messageId)) {
        return 'static';
      }
      if (completedIds.has(messageId)) {
        return 'complete';
      }
      if (messageId === activePresentationId) {
        return 'active';
      }
      return 'queued';
    },
    [
      activePresentationId,
      completedIds,
      currentTurnModelSet,
      turnUserId,
    ]
  );

  const markComplete = useCallback((messageId: string) => {
    setCompletedIds((previous) => {
      if (previous.has(messageId)) return previous;
      const next = new Set(previous);
      next.add(messageId);
      return next;
    });
  }, []);

  const hasCurrentTurnOutput = turnData.modelMessages.some(
    (message) => Boolean(message.content.trim())
  );

  const isCurrentTurnSettled =
    !turnUserId ||
    turnData.modelMessages.length === 0 ||
    turnData.modelMessages.every((message) => {
      if (completedIds.has(message.id)) return true;

      // Empty, non-streaming placeholders are not presentable content. They
      // should never block final controls if a provider/tool path removed its
      // visible answer.
      return (
        !message.isStreaming &&
        !message.content.trim() &&
        !message.attachment_urls?.length &&
        !message.image_url
      );
    });

  return {
    phaseFor,
    markComplete,
    activePresentationId,
    currentTurnModelIds: turnData.modelIds,
    hasCurrentTurnOutput,
    isCurrentTurnSettled,
  };
}
