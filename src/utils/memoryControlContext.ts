import type { Round } from './discussionMemory';

export const MEMORY_CONTROL_MAX_RECENT_ROUNDS = 3;
export const MEMORY_CONTROL_MESSAGE_CHAR_LIMIT = 2200;
export const MEMORY_CONTROL_REQUEST_CHAR_LIMIT = 6000;

export interface MemoryControlRound {
  user: string;
  chatgpt?: string;
  claude?: string;
  gemini?: string;
}

export interface MemoryControlContext {
  currentRequest: string;
  recentRounds: MemoryControlRound[];
  policy: {
    maxRecentRounds: number;
    messageCharLimit: number;
    requestCharLimit: number;
  };
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated]`;
}

export function buildMemoryControlContext(
  prompt: string,
  rounds?: Round[]
): MemoryControlContext {
  const recent = Array.isArray(rounds)
    ? rounds.slice(-MEMORY_CONTROL_MAX_RECENT_ROUNDS)
    : [];

  const recentRounds = recent.map((round) => {
    const compact: MemoryControlRound = {
      user: clip(
        round.userPrompt || '',
        MEMORY_CONTROL_MESSAGE_CHAR_LIMIT
      ),
    };

    for (const response of round.modelResponses || []) {
      const sender = String(response.name || '').toLowerCase();
      const responseContent = clip(
        response.content || '',
        MEMORY_CONTROL_MESSAGE_CHAR_LIMIT
      );
      if (!responseContent) continue;

      if (
        sender.includes('chatgpt') ||
        sender === 'gpt' ||
        sender.includes('openai')
      ) {
        compact.chatgpt = responseContent;
      } else if (
        sender.includes('claude') ||
        sender.includes('anthropic')
      ) {
        compact.claude = responseContent;
      } else if (
        sender.includes('gemini') ||
        sender.includes('google')
      ) {
        compact.gemini = responseContent;
      }
    }

    return compact;
  });

  return {
    currentRequest: clip(
      prompt || '',
      MEMORY_CONTROL_REQUEST_CHAR_LIMIT
    ),
    recentRounds,
    policy: {
      maxRecentRounds: MEMORY_CONTROL_MAX_RECENT_ROUNDS,
      messageCharLimit: MEMORY_CONTROL_MESSAGE_CHAR_LIMIT,
      requestCharLimit: MEMORY_CONTROL_REQUEST_CHAR_LIMIT,
    },
  };
}
