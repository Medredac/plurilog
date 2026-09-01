import OpenAI from 'openai';
import { SupabaseClient } from '@supabase/supabase-js';

export interface HistoryMessage {
  id?: string;
  discussion_id: string;
  sender: string;
  content: string;
  created_at?: string;
}

export interface Round {
  userMessageId?: string;
  userPrompt: string;
  modelResponses: { name: string; content: string }[];
}

export interface DiscussionMemoryResult {
  summary?: string;
  recentRounds: Round[];
}

/**
 * Groups raw chronological messages from the messages table into conversational rounds.
 * A round begins with a user prompt followed by all panelist responses for that turn.
 */
export function groupMessagesIntoRounds(
  messages: HistoryMessage[],
  currentPrompt: string
): Round[] {
  const rounds: Round[] = [];
  let currentRound: Round | null = null;

  for (const msg of messages) {
    if (msg.sender === 'user') {
      if (currentRound && currentRound.userPrompt.trim()) {
        rounds.push(currentRound);
      }
      currentRound = {
        userMessageId: msg.id,
        userPrompt: msg.content || '',
        modelResponses: [],
      };
    } else if (currentRound) {
      let modelName = msg.sender;
      const lower = msg.sender.toLowerCase();
      if (lower.includes('gemini') || lower.includes('google')) modelName = 'Gemini';
      else if (lower.includes('claude') || lower.includes('anthropic')) modelName = 'Claude';
      else if (lower.includes('chatgpt') || lower.includes('gpt') || lower.includes('openai')) modelName = 'ChatGPT';

      currentRound.modelResponses.push({
        name: modelName,
        content: msg.content || '',
      });
    }
  }

  if (currentRound && currentRound.userPrompt.trim()) {
    // If this round matches the active prompt (or is a continue round with prompt='') and has 0 model responses yet, it's the currently in-flight turn
    const isCurrentInFlight =
      currentRound.modelResponses.length === 0 &&
      (currentPrompt.trim() === '' || currentRound.userPrompt.trim() === currentPrompt.trim());

    if (!isCurrentInFlight) {
      rounds.push(currentRound);
    }
  }

  return rounds;
}

/**
 * Generates or updates a rolling summary of older discussion rounds using google/gemini-3.1-flash-lite.
 */
async function generateRollingSummary(
  openai: OpenAI,
  olderRounds: Round[],
  existingSummary?: string
): Promise<string> {
  const olderRoundsFormatted = olderRounds
    .map((r, i) => {
      const isContinueUser = r.userPrompt.trim().toLowerCase() === 'continue';
      const userPart = isContinueUser ? '' : `User asked: "${r.userPrompt}"\n`;
      const responses = r.modelResponses
        .map((mr) => `${mr.name} said:\n"""\n${mr.content}\n"""`)
        .join('\n\n');
      return `[Round ${i + 1}]\n${userPart}${responses}`.trim();
    })
    .join('\n\n---\n\n');

  const promptContent = existingSummary
    ? `You are an expert synthesizer. Update the existing discussion summary by integrating the newly archived conversation rounds below.\n\nExisting Summary:\n"""\n${existingSummary}\n"""\n\nNew archived conversation rounds to add:\n"""\n${olderRoundsFormatted}\n"""\n\nProvide a concise 2-3 paragraph rolling summary preserving key discussion arguments, shared insights, and critical context.`
    : `You are an expert synthesizer. Condense the following older conversation rounds into a concise 2-3 paragraph summary highlighting the main topics, key viewpoints, and core context.\n\nConversation rounds:\n"""\n${olderRoundsFormatted}\n"""`;

  try {
    const res = await openai.chat.completions.create({
      model: 'google/gemini-3.1-flash-lite',
      messages: [
        {
          role: 'system',
          content: 'You are an objective summarizer. Create a clear, concise summary of earlier discussion history.',
        },
        {
          role: 'user',
          content: promptContent,
        },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    const summary = res.choices[0]?.message?.content?.trim();
    return summary || existingSummary || '';
  } catch (err) {
    console.error('[Memory] Error generating rolling summary with gemini-3.1-flash-lite:', err);
    return existingSummary || '';
  }
}

/**
 * Fetches historical context strictly scoped to the provided discussionId using the authenticated server Supabase client.
 * 
 * Strict discussion isolation: Every query pulling historical messages or summary
 * MUST filter strictly by discussion_id — memory must NEVER leak across discussions.
 */
export async function getScopedDiscussionMemory(
  discussionId: string,
  currentPrompt: string,
  openai: OpenAI,
  supabase: SupabaseClient
): Promise<DiscussionMemoryResult> {
  if (!supabase || !discussionId) {
    return { recentRounds: [] };
  }

  try {
    // 1. Fetch raw messages strictly filtered by this discussion_id using authenticated client
    // Strict discussion isolation: Memory is strictly scoped to this discussion_id and must never leak across discussions.
    const { data: rawMessages, error: msgError } = await supabase
      .from('messages')
      .select('*')
      .eq('discussion_id', discussionId)
      .order('created_at', { ascending: true });

    if (msgError) {
      console.error('[Memory] Error fetching messages for discussion:', msgError, { discussion_id: discussionId });
      return { recentRounds: [] };
    }

    console.log(`[Memory Debug] Fetched ${rawMessages?.length || 0} raw messages from DB for discussion ${discussionId}`);

    // 2. Fetch discussion metadata (summary) strictly filtered by this discussion_id
    // Strict discussion isolation: Memory is strictly scoped to this discussion_id and must never leak across discussions.
    const { data: discussion, error: discError } = await supabase
      .from('discussions')
      .select('id, summary')
      .eq('id', discussionId)
      .single();

    if (discError && discError.code !== 'PGRST116') {
      console.warn('[Memory] Warning fetching discussion summary:', discError, { discussion_id: discussionId });
    }

    const allRounds = groupMessagesIntoRounds(rawMessages || [], currentPrompt);
    console.log(`[Memory Debug] Grouped into ${allRounds.length} prior rounds:`, JSON.stringify(allRounds, null, 2));
    const totalRounds = allRounds.length;

    // Sliding window: last 5 rounds of history in full raw detail
    if (totalRounds <= 5) {
      return {
        summary: discussion?.summary || undefined,
        recentRounds: allRounds,
      };
    }

    // More than 5 rounds: keep last 5 rounds raw, summarize older rounds
    const recentRounds = allRounds.slice(-5);
    const olderRounds = allRounds.slice(0, totalRounds - 5);
    let summary = discussion?.summary || '';

    // Re-generate rolling summary when crossing threshold or when older rounds grow by 5
    const shouldRegenerateSummary = !summary || olderRounds.length % 5 === 0;

    if (shouldRegenerateSummary) {
      console.log(`[Memory] Generating rolling summary for ${olderRounds.length} older rounds in discussion ${discussionId}...`);
      const newSummary = await generateRollingSummary(openai, olderRounds, summary);

      if (newSummary && newSummary !== summary) {
        summary = newSummary;
        // Persist rolling summary to discussions table strictly for this discussion_id
        // Strict discussion isolation: Memory is strictly scoped to this discussion_id and must never leak across discussions.
        try {
          const { error: updateErr } = await supabase
            .from('discussions')
            .update({ summary: newSummary })
            .eq('id', discussionId);

          if (updateErr) {
            console.error('[Memory] Failed to save summary on discussions table:', updateErr, { discussion_id: discussionId });
          } else {
            console.log(`[Memory] Successfully stored updated rolling summary on discussion ${discussionId}`);
          }
        } catch (updateEx) {
          console.error('[Memory] Exception updating summary on discussions table:', updateEx);
        }
      }
    }

    return {
      summary: summary || undefined,
      recentRounds,
    };
  } catch (err) {
    console.error('[Memory] Exception in getScopedDiscussionMemory:', err, { discussion_id: discussionId });
    return { recentRounds: [] };
  }
}
