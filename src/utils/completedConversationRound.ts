import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Keep panel authorship explicit: a Continue click is not a new user statement. */
export function completedRoundText(options: {
  prompt: string;
  isContinueRound: boolean;
  responses: { name: string; response: string }[];
}): string | null {
  const responses = options.responses.filter(response => response.response?.trim());
  if (!responses.length || (!options.isContinueRound && !options.prompt.trim())) return null;
  let text = options.isContinueRound
    ? 'Panel continuation (the user clicked Continue; no new user statement).'
    : `User said:\n"""\n${options.prompt}\n"""`;
  for (const response of responses) {
    text += `\n\n${response.name} said:\n"""\n${response.response}\n"""`;
  }
  return text;
}

export async function indexCompletedConversationRound(options: {
  supabase: SupabaseClient;
  openai: OpenAI;
  discussionId?: string | null;
  sourceUserMessageId?: string | null;
  isContinueRound: boolean;
  prompt: string;
  responses: { name: string; response: string }[];
  signal?: AbortSignal;
}): Promise<void> {
  const { supabase, openai, discussionId, sourceUserMessageId, signal } = options;
  const content = completedRoundText(options);
  if (!discussionId || !sourceUserMessageId || !content || signal?.aborted) return;

  // The session client enforces RLS; also bind the anchor to this discussion.
  const { data: anchor, error: anchorError } = await supabase.from('messages')
    .select('id, sender, content').eq('id', sourceUserMessageId)
    .eq('discussion_id', discussionId).single();
  if (anchorError || anchor?.sender !== 'user' ||
      (options.isContinueRound && anchor.content?.trim() !== 'Continue')) {
    throw new Error('Conversation memory anchor is missing or invalid');
  }
  if (signal?.aborted) return;
  const response = await openai.embeddings.create({
    model: 'google/gemini-embedding-2', dimensions: 1536,
    input: content, encoding_format: 'float',
  }, { timeout: 10000, ...(signal ? { signal } : {}) });
  const embedding = response?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== 1536 || !embedding.every(Number.isFinite)) {
    throw new Error('Invalid conversation memory embedding');
  }
  if (signal?.aborted) return;
  const { error } = await supabase.from('discussion_memory_chunks').upsert({
    discussion_id: discussionId, source_user_message_id: sourceUserMessageId,
    content, embedding,
  }, { onConflict: 'discussion_id,source_user_message_id' });
  if (error) throw error;
  console.log('[Memory Index] Stored round memory', {
    discussionId, sourceUserMessageId, isContinueRound: options.isContinueRound,
    characterCount: content.length, successfulPanelResponses: options.responses.length,
  });
}
