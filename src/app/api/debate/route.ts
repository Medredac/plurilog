import { NextRequest } from 'next/server';
import OpenAI from 'openai';

interface ModelConfig {
  seatId: 'gemini' | 'claude' | 'chatgpt';
  modelId: string;
  name: string;
  systemPrompt: string;
}

const COUNCIL_SEATS: ModelConfig[] = [
  {
    seatId: 'gemini',
    modelId: 'google/gemini-2.5-flash',
    name: 'Gemini',
    systemPrompt: `You are Gemini in a collaborative 3-way AI discussion.
Open the discussion by outlining the core first principles, key variables, and your clear perspective on the user's topic.
Be direct, insightful, and concise (2-3 short paragraphs max).`,
  },
  {
    seatId: 'claude',
    modelId: 'anthropic/claude-haiku-4.5',
    name: 'Claude',
    systemPrompt: `You are Claude in a collaborative 3-way AI discussion.
You are responding after Gemini.
Evaluate the user's question and Gemini's response. Probe any assumptions, highlight nuances or counter-perspectives, and add depth to the discussion.
Be analytical, thoughtful, and concise (2-3 short paragraphs max).`,
  },
  {
    seatId: 'chatgpt',
    modelId: 'openai/gpt-4o-mini',
    name: 'ChatGPT',
    systemPrompt: `You are ChatGPT in a collaborative 3-way AI discussion.
You are responding after Gemini and Claude.
Evaluate the viewpoints from both Gemini and Claude, synthesize the core trade-offs, and offer a practical conclusion or recommendation.
Be structured, objective, and concise (2-3 short paragraphs max).`,
  },
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

        let geminiResponse = '';
        let claudeResponse = '';
        let chatgptResponse = '';

        try {
          // ==========================================
          // 1. Gemini
          // ==========================================
          const seat1 = COUNCIL_SEATS[0];
          sendEvent('seat_start', {
            seatId: seat1.seatId,
            modelId: seat1.modelId,
            name: seat1.name,
          });

          const seat1Messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: seat1.systemPrompt },
            { role: 'user', content: prompt },
          ];

          try {
            const stream1 = await openai.chat.completions.create({
              model: seat1.modelId,
              messages: seat1Messages,
              stream: true,
              max_tokens: 800,
              temperature: 0.7,
            });

            for await (const chunk of stream1) {
              const text = chunk.choices[0]?.delta?.content || '';
              if (text) {
                geminiResponse += text;
                sendEvent('seat_chunk', {
                  seatId: seat1.seatId,
                  text: text,
                });
              }
            }

            if (!geminiResponse.trim()) {
              throw new Error(`Received empty response from ${seat1.name}.`);
            }

            sendEvent('seat_done', {
              seatId: seat1.seatId,
              modelId: seat1.modelId,
              content: geminiResponse,
            });
          } catch (err1: any) {
            console.error(`Error with ${seat1.name}:`, err1);
            sendEvent('error', {
              seatId: seat1.seatId,
              message: `${seat1.name} error: ${err1?.message || 'Request failed'}`,
            });
            safeClose();
            return;
          }

          // ==========================================
          // 2. Claude (anthropic/claude-3.5-haiku)
          // ==========================================
          const seat2 = COUNCIL_SEATS[1];
          sendEvent('seat_start', {
            seatId: seat2.seatId,
            modelId: seat2.modelId,
            name: seat2.name,
          });

          const seat2Messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: seat2.systemPrompt },
            {
              role: 'user',
              content: `The user asked: "${prompt}"\n\nGemini responded with:\n"""\n${geminiResponse}\n"""\n\nProvide your analysis, counter-points, or added perspective.`,
            },
          ];

          try {
            const stream2 = await openai.chat.completions.create({
              model: seat2.modelId,
              messages: seat2Messages,
              stream: true,
              max_tokens: 800,
              temperature: 0.7,
            });

            for await (const chunk of stream2) {
              const text = chunk.choices[0]?.delta?.content || '';
              if (text) {
                claudeResponse += text;
                sendEvent('seat_chunk', {
                  seatId: seat2.seatId,
                  text: text,
                });
              }
            }

            if (!claudeResponse.trim()) {
              throw new Error(`Received empty response from ${seat2.name}.`);
            }

            sendEvent('seat_done', {
              seatId: seat2.seatId,
              modelId: seat2.modelId,
              content: claudeResponse,
            });
          } catch (err2: any) {
            console.error(`Error with ${seat2.name}:`, err2);
            sendEvent('error', {
              seatId: seat2.seatId,
              message: `${seat2.name} error: ${err2?.message || 'Request failed'}`,
            });
            safeClose();
            return;
          }

          // ==========================================
          // 3. ChatGPT (openai/gpt-4o-mini)
          // ==========================================
          const seat3 = COUNCIL_SEATS[2];
          sendEvent('seat_start', {
            seatId: seat3.seatId,
            modelId: seat3.modelId,
            name: seat3.name,
          });

          const seat3Messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: seat3.systemPrompt },
            {
              role: 'user',
              content: `The user asked: "${prompt}"\n\nGemini said:\n"""\n${geminiResponse}\n"""\n\nClaude said:\n"""\n${claudeResponse}\n"""\n\nSynthesize the key points and provide a practical conclusion.`,
            },
          ];

          try {
            const stream3 = await openai.chat.completions.create({
              model: seat3.modelId,
              messages: seat3Messages,
              stream: true,
              max_tokens: 800,
              temperature: 0.7,
            });

            for await (const chunk of stream3) {
              const text = chunk.choices[0]?.delta?.content || '';
              if (text) {
                chatgptResponse += text;
                sendEvent('seat_chunk', {
                  seatId: seat3.seatId,
                  text: text,
                });
              }
            }

            if (!chatgptResponse.trim()) {
              throw new Error(`Received empty response from ${seat3.name}.`);
            }

            sendEvent('seat_done', {
              seatId: seat3.seatId,
              modelId: seat3.modelId,
              content: chatgptResponse,
            });
          } catch (err3: any) {
            console.error(`Error with ${seat3.name}:`, err3);
            sendEvent('error', {
              seatId: seat3.seatId,
              message: `${seat3.name} error: ${err3?.message || 'Request failed'}`,
            });
            safeClose();
            return;
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
