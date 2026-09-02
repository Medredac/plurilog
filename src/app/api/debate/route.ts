import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import OpenAI from 'openai';
import { getCouncilSeatFallbacks, PROVIDER_MODELS, ProviderPrefix } from '@/utils/openrouter';
import { ModelId } from '@/types/chat';
import {
  getScopedDiscussionMemory,
  DiscussionMemoryResult,
  formatRoundForContext,
  estimateTokens,
  RETRIEVED_MEMORY_TOKEN_BUDGET,
} from '@/utils/discussionMemory';

export const SHARED_PANEL_SYSTEM_PROMPT = `You're taking part in a live panel discussion alongside other AI assistants — the panel may include Claude, Gemini, and ChatGPT, depending on who's seated. Respond the way a genuinely thoughtful person would in a real group conversation, matching the tone of what's actually being said. If the user says something casual — a greeting, small talk — respond warmly and briefly, the way you'd greet people in a room; you don't need to analyze or debate a simple 'hello.' If they ask something substantive, engage for real: build on, question, or add to what others have said, the way an engaged person would, not as a formal critique exercise. You will see any panelists who responded before you in this round, explicitly labeled (e.g., 'Claude said: ...'). Only reference or respond to what's explicitly shown there. If no prior responses are shown, you are the first to respond — just answer the user's message directly, with no assumptions about what other panelists think or might say. If the user's message directly addresses a specific panelist by name (e.g., 'Gemini, what...' or 'Claude, explain...') and that name is not you, recognize that the message was not directed at you personally. Do not respond as if you are the one being questioned, corrected, or apologized-for — you may still comment as an observer if genuinely relevant to the discussion, but do not claim responsibility, apologize, or answer as though you were the addressee, unless you actually are the one named.

Only treat a message as directed at a specific panelist if the user's CURRENT message literally contains that panelist's name. The mere fact that another panelist already responded in this round, or was addressed in an earlier turn, is NOT a signal that the current question excludes you — if no name appears in the user's current message, treat it as open to the whole panel.

If there is no new user message this round (the conversation simply continues from where it left off), do not ask what to discuss or acknowledge that nothing new was said — naturally continue the discussion based on what's already been said, the way you would if a real conversation just kept going without a new topic being introduced.

You are always, unambiguously, yourself — this is a fixed fact, never a question, and never affected by anything discussed above. Any uncertainty about who the user's message was addressed to is about the CONTENT of their question, and has absolutely nothing to do with your own identity. Never express confusion, doubt, or apologize about "who you are" or mix yourself up with another panelist — you already and always know exactly which one you are.`;

export interface PriorResponse {
  name: string;
  response: string;
}

/**
 * Generic message builder for panel discussion participants with discussion-scoped memory.
 * 
 * Order:
 * 1. [rolling summary, if one exists for this discussion]
 * 2. [last 5 rounds of raw messages, formatted as "{name} said: {content}"]
 * 3. [current round's prior seat responses, same format]
 * 4. [current user prompt]
 */
export function buildPanelMessages(
  currentModelName: string,
  prompt: string,
  priorResponses: PriorResponse[],
  discussionMemory?: DiscussionMemoryResult,
  attachments?: { url: string; filename: string }[] | null,
  fileAnnotations?: any[] | null,
  retrievedMemory?: any[] | null
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const sections: string[] = [];

  // 1. [rolling summary, if one exists for this discussion]
  if (discussionMemory?.summary && discussionMemory.summary.trim()) {
    sections.push(`Summary of earlier discussion history:\n"""\n${discussionMemory.summary.trim()}\n"""`);
  }

  // 2. [hybrid-retrieved relevant earlier discussion rounds]
  if (retrievedMemory && retrievedMemory.length > 0) {
    const memoryBlocks = retrievedMemory
      .map((row) => (typeof row?.content === 'string' ? row.content.trim() : ''))
      .filter(Boolean)
      .join('\n\n---\n\n');

    if (memoryBlocks) {
      sections.push(`Relevant earlier discussion:\n${memoryBlocks}`);
    }
  }

  // 3. [targeted chronological conversation history]
  if (discussionMemory?.chronologicalMemory && discussionMemory.chronologicalMemory.content) {
    const cm = discussionMemory.chronologicalMemory;
    sections.push(
      `Targeted conversation-history result (evaluated at the moment you asked, before any responses in the current round):\n${cm.label}:\n"""\n${cm.content.trim()}\n"""`
    );
  }

  // 4. [recent exact conversation rounds within token budget]
  if (discussionMemory?.recentRounds && discussionMemory.recentRounds.length > 0) {
    const rawRoundsFormatted = discussionMemory.recentRounds
      .map(formatRoundForContext)
      .filter(Boolean)
      .join('\n\n');

    if (rawRoundsFormatted) {
      sections.push(`Prior conversation rounds:\n${rawRoundsFormatted}`);
    }
  }

  // 5. [current round's prior seat responses]
  if (priorResponses.length > 0) {
    const priorFormatted = priorResponses
      .map((p) => `${p.name} said:\n"""\n${p.response}\n"""\n\n`)
      .join('');

    if (discussionMemory?.chronologicalMemory) {
      sections.push(
        `Current-round panelist responses generated after your question:\n${priorFormatted.trimEnd()}`
      );
    } else {
      sections.push(priorFormatted.trimEnd());
    }
  }

  // 6. [chronology-specific instruction before the current prompt]
  if (discussionMemory?.chronologicalMemory) {
    sections.push(
      `For this chronology question, the targeted conversation-history result above is the authoritative answer for the requested chronological position at the moment you asked. Current-round panelist responses happened afterward. Only for speaker-specific last/latest/most-recent queries, if that same speaker has responded again in the current round, explicitly distinguish the two time points: first give the historical result as of when you asked, then briefly note what the speaker has said since. For first/earliest/ordinal queries, do not add a current-round update.`
    );
  }

  const trimmedPrompt = prompt.trim();
  let userContent = trimmedPrompt;
  if (sections.length > 0) {
    userContent = trimmedPrompt
      ? `${sections.join('\n\n')}\n\n${trimmedPrompt}`
      : sections.join('\n\n');
  }

  const systemContent = `You are participating in this panel as ${currentModelName}. ${SHARED_PANEL_SYSTEM_PROMPT}`;

  // When reusing existing PDF file annotations via OpenRouter's documented assistant-message pattern:
  if (fileAnnotations && fileAnnotations.length > 0 && attachments && attachments.length > 0) {
    const pdfBlocks: any[] = [];
    const nonPdfBlocks: any[] = [];

    for (const attachment of attachments) {
      const isPdf = attachment.url.split('?')[0].toLowerCase().endsWith('.pdf');
      if (isPdf) {
        pdfBlocks.push({
          type: 'file',
          file: {
            filename: attachment.filename || 'attachment.pdf',
            file_data: attachment.url,
          },
        });
      } else {
        nonPdfBlocks.push({
          type: 'image_url',
          image_url: { url: attachment.url },
        });
      }
    }

    if (pdfBlocks.length > 0) {
      const currentUserBlocks: any[] = [];
      if (userContent.trim()) {
        currentUserBlocks.push({ type: 'text', text: userContent });
      }
      currentUserBlocks.push(...nonPdfBlocks);

      return [
        {
          role: 'system',
          content: systemContent,
        },
        {
          role: 'user',
          content: pdfBlocks,
        },
        {
          role: 'assistant',
          content: 'PDF document context loaded.',
          annotations: fileAnnotations,
        } as any,
        {
          role: 'user',
          content:
            currentUserBlocks.length > 0
              ? currentUserBlocks
              : (userContent || 'Please respond to the attached PDF document context.'),
        },
      ];
    }
  }

  let userMessageParam: OpenAI.Chat.Completions.ChatCompletionMessageParam;

  if (attachments && attachments.length > 0) {
    const contentBlocks: any[] = [];
    if (userContent.trim()) {
      contentBlocks.push({ type: 'text', text: userContent });
    }

    for (const attachment of attachments) {
      const isPdf = attachment.url.split('?')[0].toLowerCase().endsWith('.pdf');
      if (isPdf) {
        contentBlocks.push({
          type: 'file',
          file: {
            filename: attachment.filename || 'attachment.pdf',
            file_data: attachment.url,
          },
        });
      } else {
        contentBlocks.push({
          type: 'image_url',
          image_url: { url: attachment.url },
        });
      }
    }

    userMessageParam = {
      role: 'user',
      content: contentBlocks,
    };
  } else {
    userMessageParam = {
      role: 'user',
      content: userContent,
    };
  }

  return [
    {
      role: 'system',
      content: systemContent,
    },
    userMessageParam,
  ];
}

interface SeatConfig {
  seatId: ModelId;
  name: string;
  providerPrefix: ProviderPrefix;
}

const SEAT_DEFINITIONS: Record<ModelId, SeatConfig> = {
  gemini: { seatId: 'gemini', name: 'Gemini', providerPrefix: 'google/' },
  claude: { seatId: 'claude', name: 'Claude', providerPrefix: 'anthropic/' },
  chatgpt: { seatId: 'chatgpt', name: 'ChatGPT', providerPrefix: 'openai/' },
};

export async function POST(req: NextRequest) {
  try {
    const { prompt, discussionId, seatOrder, isContinueRound, attachments, sourceUserMessageId } = await req.json();

    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (typeof prompt !== 'string' || (!isContinueRound && !prompt.trim() && !hasAttachments)) {
      return new Response(
        JSON.stringify({ error: 'A valid prompt string is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey || apiKey.trim() === '') {
      return new Response(
        JSON.stringify({
          error:
            'OPENROUTER_API_KEY is not configured in .env.local. Please add your OpenRouter API key.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Authenticated Supabase client using user session cookies
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignore in Route Handler
            }
          },
        },
      }
    );

    // Pre-flight balance check using session-authenticated Supabase client
    const { data: balanceRows, error: balanceError } = await supabase.rpc('get_my_balance');
    const balance = balanceRows?.[0];
    if (balanceError || !balance) {
      console.error('[Spend Tracking] Error fetching balance:', balanceError);
      return new Response(
        JSON.stringify({ error: 'Could not verify account balance.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (Number(balance.remaining_cents) <= 0) {
      return new Response(
        JSON.stringify({
          error:
            balance.plan === 'free'
              ? 'Your free trial credit is used up. Upgrade to continue.'
              : "You've used your credits for this billing period.",
          code: 'INSUFFICIENT_CREDITS',
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get hardcoded fallback arrays for each seat
    const seatFallbacks = getCouncilSeatFallbacks();

    const openai = new OpenAI({
      apiKey: apiKey.trim(),
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://plurilog.app',
        'X-Title': 'Plurilog',
      },
    });

    // Strict discussion isolation: Memory is strictly scoped to this discussion_id and must never leak across discussions.
    let discussionMemory: DiscussionMemoryResult | undefined;
    if (discussionId) {
      discussionMemory = await getScopedDiscussionMemory(discussionId, prompt, openai, supabase);
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let isClosed = false;

        const sendEvent = (event: string, data: any) => {
          if (isClosed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch (enqueueErr) {
            console.error('Error enqueuing event:', enqueueErr);
          }
        };

        const safeClose = () => {
          if (!isClosed) {
            isClosed = true;
            try {
              controller.close();
            } catch (closeErr) {
              console.error('Error closing stream:', closeErr);
            }
          }
        };

        const priorResponses: PriorResponse[] = [];
        const roundFileAnnotations: any[] = [];
        const addFileAnnotations = (raw: any) => {
          if (!raw) return;
          const annList = Array.isArray(raw) ? raw : [raw];
          for (const ann of annList) {
            if (ann?.type === 'file' && ann?.file?.hash) {
              if (!roundFileAnnotations.some((existing) => existing?.file?.hash === ann.file.hash)) {
                roundFileAnnotations.push(ann);
              }
            }
          }
        };

        // Build active configured seats list dynamically from client seatOrder with secure server-side definitions
        let configuredSeats: SeatConfig[] = [];
        if (Array.isArray(seatOrder) && seatOrder.length > 0) {
          configuredSeats = seatOrder
            .filter((id: string): id is ModelId => id in SEAT_DEFINITIONS)
            .map((id: ModelId) => SEAT_DEFINITIONS[id]);
        }
        if (configuredSeats.length === 0) {
          configuredSeats = [
            SEAT_DEFINITIONS.gemini,
            SEAT_DEFINITIONS.claude,
            SEAT_DEFINITIONS.chatgpt,
          ];
        }

        try {
          // Attempt hybrid discussion-memory retrieval (non-critical)
          let retrievedMemory: any[] = [];
          if (discussionId && prompt && prompt.trim() && !req.signal.aborted) {
            try {
              const queryEmbeddingRes = await (openai.embeddings.create as any)(
                {
                  model: 'google/gemini-embedding-2',
                  dimensions: 1536,
                  input: prompt,
                  encoding_format: 'float',
                },
                {
                  timeout: 10000,
                  signal: req.signal,
                }
              );

              const queryEmbedding = queryEmbeddingRes?.data?.[0]?.embedding;
              if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 1536) {
                console.error(
                  '[Memory Retrieval] Missing or invalid 1536-dimension query embedding vector returned by model'
                );
              } else {
                const { data: hybridRows, error: searchErr } = await supabase.rpc(
                  'search_discussion_memory_hybrid',
                  {
                    p_discussion_id: discussionId,
                    p_query_text: prompt,
                    p_query_embedding: queryEmbedding,
                    p_match_count: 10,
                  }
                );

                if (searchErr) {
                  console.error(
                    '[Memory Retrieval] Error calling search_discussion_memory_hybrid:',
                    searchErr
                  );
                } else {
                  const recentUserMessageIds = new Set<string>();
                  if (discussionMemory?.recentRounds) {
                    for (const r of discussionMemory.recentRounds) {
                      if (r.userMessageId) {
                        recentUserMessageIds.add(r.userMessageId);
                      }
                    }
                  }
                  if (discussionMemory?.chronologicalMemory?.roundUserMessageId) {
                    recentUserMessageIds.add(discussionMemory.chronologicalMemory.roundUserMessageId);
                  }
                  if (sourceUserMessageId) {
                    recentUserMessageIds.add(sourceUserMessageId);
                  }

                  const rawCandidates: any[] = Array.isArray(hybridRows) ? hybridRows : [];
                  const qualifyingCandidates = rawCandidates.filter((row: any) => {
                    if (
                      row?.source_user_message_id &&
                      recentUserMessageIds.has(row.source_user_message_id)
                    ) {
                      return false;
                    }
                    const hasSemanticMatch =
                      typeof row?.semantic_similarity === 'number' &&
                      row.semantic_similarity >= 0.62;
                    const hasKeywordMatch =
                      row?.keyword_rank !== null && row?.keyword_rank !== undefined;
                    return hasSemanticMatch || hasKeywordMatch;
                  });

                  // Select up to 3 retrieved rounds within RETRIEVED_MEMORY_TOKEN_BUDGET.
                  // Note: The 2500-token budget is a target, not an absolute maximum,
                  // because the highest-ranked usable result is always retained even if it alone exceeds the budget.
                  const budgetedRetrievedMemory: any[] = [];
                  let retrievedEstimatedTokens = 0;

                  for (const candidate of qualifyingCandidates) {
                    if (budgetedRetrievedMemory.length >= 3) break;

                    const contentText =
                      typeof candidate?.content === 'string' ? candidate.content.trim() : '';
                    if (!contentText) continue;

                    const candidateTokens = estimateTokens(contentText);

                    if (budgetedRetrievedMemory.length === 0) {
                      // Always include the first usable/highest-ranked qualifying retrieved round
                      budgetedRetrievedMemory.push(candidate);
                      retrievedEstimatedTokens += candidateTokens;
                    } else if (
                      retrievedEstimatedTokens + candidateTokens <=
                      RETRIEVED_MEMORY_TOKEN_BUDGET
                    ) {
                      budgetedRetrievedMemory.push(candidate);
                      retrievedEstimatedTokens += candidateTokens;
                    } else {
                      // Lower-ranked candidate does not fit; continue to inspect later candidates
                      continue;
                    }
                  }

                  retrievedMemory = budgetedRetrievedMemory;

                  console.log('[Memory Retrieval] Hybrid search completed', {
                    discussionId,
                    candidateCount: rawCandidates.length,
                    resultCount: retrievedMemory.length,
                    retrievedEstimatedTokens,
                    retrievedTokenBudget: RETRIEVED_MEMORY_TOKEN_BUDGET,
                    results: retrievedMemory.map((row: any) => ({
                      id: row?.id,
                      source_user_message_id: row?.source_user_message_id,
                      semantic_rank: row?.semantic_rank,
                      keyword_rank: row?.keyword_rank,
                      hybrid_score: row?.hybrid_score,
                      semantic_similarity: row?.semantic_similarity,
                      content: row?.content ? row.content.slice(0, 120) : '',
                    })),
                  });
                }
              }
            } catch (retrievalErr: any) {
              console.error(
                '[Memory Retrieval] Error during hybrid memory retrieval:',
                retrievalErr
              );
            }
          }

          // Sequential panel execution across configured seats in custom order
          for (const seat of configuredSeats) {
            if (req.signal.aborted) {
              safeClose();
              return;
            }

            const models = seatFallbacks[seat.seatId] || PROVIDER_MODELS[seat.providerPrefix];
            const primaryModel = models[0];
            let respondingModel = primaryModel;
            let seatResponse = '';
            let seatUsage: any = null;

            sendEvent('seat_start', {
              seatId: seat.seatId,
              modelId: primaryModel,
              name: seat.name,
            });

            const pdfAttachments = attachments?.filter((att: any) =>
              att.url?.split('?')[0].toLowerCase().endsWith('.pdf')
            ) || [];
            const hasPdf = pdfAttachments.length > 0;

            // Only reuse when annotations have been captured for ALL PDF attachments in current request
            const hasAllPdfAnnotations =
              hasPdf &&
              roundFileAnnotations.length >= pdfAttachments.length &&
              pdfAttachments.every((pdf: any) =>
                roundFileAnnotations.some(
                  (ann: any) =>
                    ann?.file?.hash &&
                    (!pdf.filename || !ann?.file?.name || ann.file.name.toLowerCase() === pdf.filename.toLowerCase())
                )
              );

            const isReusingAnnotations = hasAllPdfAnnotations;
            const needsPdfParsing = hasPdf && !isReusingAnnotations;

            console.log('[PDF Annotation Relay]', {
              seatId: seat.seatId,
              mode: hasPdf ? (isReusingAnnotations ? 'reusing' : 'parsing') : 'none',
              annotationCount: roundFileAnnotations.length,
              pdfCount: pdfAttachments.length,
            });

            const seatMessages = buildPanelMessages(
              seat.name,
              prompt,
              priorResponses,
              discussionMemory,
              attachments,
              isReusingAnnotations ? roundFileAnnotations : null,
              retrievedMemory
            );

            try {
              const stream = await (openai.chat.completions.create as any)({
                model: primaryModel,
                models: models,
                messages: seatMessages,
                stream: true,
                max_tokens: 2000,
                temperature: 0.7,
                signal: req.signal,
                ...(needsPdfParsing
                  ? {
                      plugins: [
                        {
                          id: 'file-parser',
                          pdf: {
                            engine: 'mistral-ocr',
                          },
                        },
                      ],
                    }
                  : {}),
              });

              for await (const chunk of stream) {
                if (req.signal.aborted) {
                  break;
                }
                if (chunk.model) {
                  respondingModel = chunk.model;
                }
                if ((chunk as any).usage) {
                  seatUsage = (chunk as any).usage;
                }

                // Capture file annotations from chunk.choices[0].delta.annotations (deduplicated by file.hash)
                addFileAnnotations((chunk.choices?.[0]?.delta as any)?.annotations);

                const text = chunk.choices[0]?.delta?.content || '';
                if (text) {
                  seatResponse += text;
                  sendEvent('seat_chunk', {
                    seatId: seat.seatId,
                    text: text,
                  });
                }
              }

              if (req.signal.aborted) {
                safeClose();
                return;
              }

              console.log(
                `[Model Route] Provider: ${seat.providerPrefix} | Primary Requested: ${primaryModel} | Responding Model: ${respondingModel}`
              );

              if (!seatResponse.trim()) {
                throw new Error(`Received empty response from ${seat.name}.`);
              }

              sendEvent('seat_done', {
                seatId: seat.seatId,
                modelId: respondingModel,
                content: seatResponse,
              });

              if (seatUsage) {
                console.log(
                  `[Spend Tracking Debug] Raw seatUsage for ${seat.name}:`,
                  JSON.stringify(seatUsage, null, 2)
                );
              }

              if (seatUsage && typeof seatUsage.cost === 'number') {
                const costCents = seatUsage.cost * 100; // dollars → cents, full precision, no rounding
                if (costCents > 0) {
                  const { error: spendError } = await supabase.rpc('spend_credits', {
                    p_cents: costCents,
                    p_model: respondingModel,
                    p_discussion_id: discussionId || null,
                    p_meta: { seatId: seat.seatId },
                  });
                  if (spendError) {
                    console.error(
                      `[Spend Tracking] Failed to record spend for ${seat.name}:`,
                      spendError
                    );
                  }
                }
              } else {
                console.warn(
                  `[Spend Tracking] No usage/cost data received for ${seat.name} — spend not recorded for this call.`
                );
              }

              // Record in prior responses for subsequent speakers
              priorResponses.push({
                name: seat.name,
                response: seatResponse,
              });
            } catch (err: any) {
              if (req.signal.aborted || err?.name === 'AbortError') {
                safeClose();
                return;
              }

              // Capture reusable file annotations from error path if present
              addFileAnnotations(err?.error?.metadata?.file_annotations);

              console.error(`Error with ${seat.name}:`, err);
              sendEvent('error', {
                seatId: seat.seatId,
                message: `${seat.name}: ${err?.message || 'Model request failed'}`,
              });
              continue;
            }
          }

          // Index completed text discussion round in discussion_memory_chunks (non-critical)
          if (
            discussionId &&
            sourceUserMessageId &&
            prompt &&
            prompt.trim() &&
            priorResponses.length > 0 &&
            !req.signal.aborted
          ) {
            try {
              let completedRoundText = `User said:\n"""\n${prompt}\n"""`;
              for (const resp of priorResponses) {
                completedRoundText += `\n\n${resp.name} said:\n"""\n${resp.response}\n"""`;
              }

              const embeddingResponse = await (openai.embeddings.create as any)(
                {
                  model: 'google/gemini-embedding-2',
                  dimensions: 1536,
                  input: completedRoundText,
                  encoding_format: 'float',
                },
                {
                  timeout: 10000,
                  signal: req.signal,
                }
              );

              const embedding = embeddingResponse?.data?.[0]?.embedding;
              if (!Array.isArray(embedding) || embedding.length !== 1536) {
                console.error('[Memory Index] Missing or invalid 1536-dimension embedding vector returned by model');
              } else {
                const { error: upsertErr } = await supabase
                  .from('discussion_memory_chunks')
                  .upsert(
                    {
                      discussion_id: discussionId,
                      source_user_message_id: sourceUserMessageId,
                      content: completedRoundText,
                      embedding: embedding,
                    },
                    { onConflict: 'discussion_id,source_user_message_id' }
                  );

                if (upsertErr) {
                  console.error('[Memory Index] Supabase upsert error:', upsertErr);
                } else {
                  console.log('[Memory Index] Stored round memory', {
                    discussionId,
                    sourceUserMessageId,
                    characterCount: completedRoundText.length,
                    successfulPanelResponses: priorResponses.length,
                  });
                }
              }
            } catch (memErr: any) {
              console.error('[Memory Index] Error indexing round memory:', memErr);
            }
          }

          // Complete event
          sendEvent('council_done', {
            status: 'completed',
          });
        } catch (globalErr: any) {
          console.error('Fatal API stream error:', globalErr);
          sendEvent('error', {
            message: globalErr?.message || 'An unexpected error occurred.',
          });
        } finally {
          safeClose();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('API route error:', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal Server Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
