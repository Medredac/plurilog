import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getCouncilSeatFallbacks, PROVIDER_MODELS, ProviderPrefix } from '@/utils/openrouter';
import { ModelId } from '@/types/chat';

export const SHARED_PANEL_SYSTEM_PROMPT = `You're taking part in a live panel discussion alongside other AI assistants — the panel may include Claude, Gemini, and ChatGPT, depending on who's seated. Respond the way a genuinely thoughtful person would in a real group conversation, matching the tone of what's actually being said. If the user says something casual — a greeting, small talk — respond warmly and briefly, the way you'd greet people in a room; you don't need to analyze or debate a simple 'hello.' If they ask something substantive, engage for real: build on, question, or add to what others have said, the way an engaged person would, not as a formal critique exercise. You will see any panelists who responded before you in this round, explicitly labeled (e.g., 'Claude said: ...'). Only reference or respond to what's explicitly shown there. If no prior responses are shown, you are the first to respond — just answer the user's message directly, with no assumptions about what other panelists think or might say.`;

export interface PriorResponse {
  name: string;
  response: string;
}

/**
 * Generic message builder for panel discussion participants.
 * Appends prior responses in natural chronological order if any exist.
 */
export function buildPanelMessages(
  currentModelName: string,
  prompt: string,
  priorResponses: PriorResponse[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  let userContent = prompt;

  if (priorResponses.length > 0) {
    const priorFormatted = priorResponses
      .map((p) => `${p.name} said:\n"""\n${p.response}\n"""\n\n`)
      .join('');
    userContent = `${prompt}\n\n${priorFormatted}`.trimEnd();
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

const SEATS: SeatConfig[] = [
  { seatId: 'gemini', name: 'Gemini', providerPrefix: 'google/' },
  { seatId: 'claude', name: 'Claude', providerPrefix: 'anthropic/' },
  { seatId: 'chatgpt', name: 'ChatGPT', providerPrefix: 'openai/' },
];

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
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

        try {
          // Sequential panel execution across configured seats
          for (const seat of SEATS) {
            const models = seatFallbacks[seat.seatId] || PROVIDER_MODELS[seat.providerPrefix];
            const primaryModel = models[0];
            let respondingModel = primaryModel;
            let seatResponse = '';

            sendEvent('seat_start', {
              seatId: seat.seatId,
              modelId: primaryModel,
              name: seat.name,
            });

            const seatMessages = buildPanelMessages(seat.name, prompt, priorResponses);

            try {
              const stream = await (openai.chat.completions.create as any)({
                model: primaryModel,
                models: models,
                messages: seatMessages,
                stream: true,
                max_tokens: 800,
                temperature: 0.7,
              });

              for await (const chunk of stream) {
                if (chunk.model) {
                  respondingModel = chunk.model;
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

              // Record in prior responses for subsequent speakers
              priorResponses.push({
                name: seat.name,
                response: seatResponse,
              });
            } catch (err: any) {
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
