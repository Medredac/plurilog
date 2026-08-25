import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import OpenAI from 'openai';
import { getCouncilSeatFallbacks, PROVIDER_MODELS, ProviderPrefix } from '@/utils/openrouter';
import { ModelId } from '@/types/chat';
import {
  getScopedDiscussionMemory,
  DiscussionMemoryResult,
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
  discussionMemory?: DiscussionMemoryResult
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const sections: string[] = [];

  // 1. [rolling summary, if one exists for this discussion]
  if (discussionMemory?.summary && discussionMemory.summary.trim()) {
    sections.push(`Summary of earlier discussion history:\n"""\n${discussionMemory.summary.trim()}\n"""`);
  }

  // 2. [last 5 rounds of raw messages, formatted as "{name} said: {content}"]
  if (discussionMemory?.recentRounds && discussionMemory.recentRounds.length > 0) {
    const rawRoundsFormatted = discussionMemory.recentRounds
      .map((round) => {
        const isContinueUser = round.userPrompt.trim().toLowerCase() === 'continue';
        const userPart = isContinueUser
          ? ''
          : `User said:\n"""\n${round.userPrompt}\n"""`;
        const modelParts = round.modelResponses
          .map((mr) => `${mr.name} said:\n"""\n${mr.content}\n"""`)
          .join('\n\n');
        if (!userPart) return modelParts;
        return modelParts ? `${userPart}\n\n${modelParts}` : userPart;
      })
      .filter(Boolean)
      .join('\n\n');

    if (rawRoundsFormatted) {
      sections.push(`Prior conversation rounds:\n${rawRoundsFormatted}`);
    }
  }

  // 3. [current round's prior seat responses, same format]
  if (priorResponses.length > 0) {
    const priorFormatted = priorResponses
      .map((p) => `${p.name} said:\n"""\n${p.response}\n"""\n\n`)
      .join('');
    sections.push(priorFormatted.trimEnd());
  }

  const trimmedPrompt = prompt.trim();
  let userContent = trimmedPrompt;
  if (sections.length > 0) {
    userContent = trimmedPrompt
      ? `${sections.join('\n\n')}\n\n${trimmedPrompt}`
      : sections.join('\n\n');
  }

  const systemContent = `You are participating in this panel as ${currentModelName}. ${SHARED_PANEL_SYSTEM_PROMPT}`;

  return [
    {
      role: 'system',
      content: systemContent,
    },
    {
      role: 'user',
      content: userContent,
    },
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
    const { prompt, discussionId, seatOrder, isContinueRound } = await req.json();

    if (typeof prompt !== 'string' || (!isContinueRound && !prompt.trim())) {
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

            const seatMessages = buildPanelMessages(
              seat.name,
              prompt,
              priorResponses,
              discussionMemory
            );

            if (seat.seatId === configuredSeats[0].seatId) {
              console.log('[Memory Debug] API payload messages for Seat 1:');
              console.log(JSON.stringify(seatMessages, null, 2));
            }

            try {
              const stream = await (openai.chat.completions.create as any)({
                model: primaryModel,
                models: models,
                messages: seatMessages,
                stream: true,
                max_tokens: 800,
                temperature: 0.7,
                signal: req.signal,
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
              console.error(`Error with ${seat.name}:`, err);
              sendEvent('error', {
                seatId: seat.seatId,
                message: `${seat.name}: ${err?.message || 'Model request failed'}`,
              });
              safeClose();
              return;
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
