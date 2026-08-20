import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getCouncilSeatFallbacks, PROVIDER_MODELS } from '@/utils/openrouter';

const SYSTEM_PROMPTS = {
  gemini: `You are Gemini in a collaborative 3-way AI discussion.
Open the discussion by outlining the core first principles, key variables, and your clear perspective on the user's topic.
Be direct, insightful, and concise (2-3 short paragraphs max).`,

  claude: `You are Claude in a collaborative 3-way AI discussion.
You are responding after Gemini.
Evaluate the user's question and Gemini's response. Probe any assumptions, highlight nuances or counter-perspectives, and add depth to the discussion.
Be analytical, thoughtful, and concise (2-3 short paragraphs max).`,

  chatgpt: `You are ChatGPT in a collaborative 3-way AI discussion.
You are responding after Gemini and Claude.
Evaluate the viewpoints from both Gemini and Claude, synthesize the core trade-offs, and offer a practical conclusion or recommendation.
Be structured, objective, and concise (2-3 short paragraphs max).`,
};

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

        let geminiResponse = '';
        let claudeResponse = '';
        let chatgptResponse = '';

        try {
          // ==========================================
          // 1. Gemini
          // ==========================================
          const geminiModels = seatFallbacks.gemini || PROVIDER_MODELS['google/'];
          const primaryGemini = geminiModels[0];
          let respondingGeminiModel = primaryGemini;

          sendEvent('seat_start', {
            seatId: 'gemini',
            modelId: primaryGemini,
            name: 'Gemini',
          });

          const seat1Messages = [
            { role: 'system', content: SYSTEM_PROMPTS.gemini },
            { role: 'user', content: prompt },
          ];

          try {
            const stream1 = await (openai.chat.completions.create as any)({
              model: primaryGemini,
              models: geminiModels,
              messages: seat1Messages,
              stream: true,
              max_tokens: 800,
              temperature: 0.7,
            });

            for await (const chunk of stream1) {
              if (chunk.model) {
                respondingGeminiModel = chunk.model;
              }
              const text = chunk.choices[0]?.delta?.content || '';
              if (text) {
                geminiResponse += text;
                sendEvent('seat_chunk', {
                  seatId: 'gemini',
                  text: text,
                });
              }
            }

            console.log(
              `[Model Route] Provider: google/ | Primary Requested: ${primaryGemini} | Responding Model: ${respondingGeminiModel}`
            );

            if (!geminiResponse.trim()) {
              throw new Error('Received empty response from Gemini.');
            }

            sendEvent('seat_done', {
              seatId: 'gemini',
              modelId: respondingGeminiModel,
              content: geminiResponse,
            });
          } catch (err1: any) {
            console.error('Error with Gemini:', err1);
            sendEvent('error', {
              seatId: 'gemini',
              message: `Gemini: ${err1?.message || 'Model request failed'}`,
            });
            safeClose();
            return;
          }

          // ==========================================
          // 2. Claude
          // ==========================================
          const claudeModels = seatFallbacks.claude || PROVIDER_MODELS['anthropic/'];
          const primaryClaude = claudeModels[0];
          let respondingClaudeModel = primaryClaude;

          sendEvent('seat_start', {
            seatId: 'claude',
            modelId: primaryClaude,
            name: 'Claude',
          });

          const seat2Messages = [
            { role: 'system', content: SYSTEM_PROMPTS.claude },
            {
              role: 'user',
              content: `The user asked: "${prompt}"\n\nGemini responded with:\n"""\n${geminiResponse}\n"""\n\nProvide your analysis, counter-points, or added perspective.`,
            },
          ];

          try {
            const stream2 = await (openai.chat.completions.create as any)({
              model: primaryClaude,
              models: claudeModels,
              messages: seat2Messages,
              stream: true,
              max_tokens: 800,
              temperature: 0.7,
            });

            for await (const chunk of stream2) {
              if (chunk.model) {
                respondingClaudeModel = chunk.model;
              }
              const text = chunk.choices[0]?.delta?.content || '';
              if (text) {
                claudeResponse += text;
                sendEvent('seat_chunk', {
                  seatId: 'claude',
                  text: text,
                });
              }
            }

            console.log(
              `[Model Route] Provider: anthropic/ | Primary Requested: ${primaryClaude} | Responding Model: ${respondingClaudeModel}`
            );

            if (!claudeResponse.trim()) {
              throw new Error('Received empty response from Claude.');
            }

            sendEvent('seat_done', {
              seatId: 'claude',
              modelId: respondingClaudeModel,
              content: claudeResponse,
            });
          } catch (err2: any) {
            console.error('Error with Claude:', err2);
            sendEvent('error', {
              seatId: 'claude',
              message: `Claude: ${err2?.message || 'Model request failed'}`,
            });
            safeClose();
            return;
          }

          // ==========================================
          // 3. ChatGPT
          // ==========================================
          const chatgptModels = seatFallbacks.chatgpt || PROVIDER_MODELS['openai/'];
          const primaryChatgpt = chatgptModels[0];
          let respondingChatgptModel = primaryChatgpt;

          sendEvent('seat_start', {
            seatId: 'chatgpt',
            modelId: primaryChatgpt,
            name: 'ChatGPT',
          });

          const seat3Messages = [
            { role: 'system', content: SYSTEM_PROMPTS.chatgpt },
            {
              role: 'user',
              content: `The user asked: "${prompt}"\n\nGemini said:\n"""\n${geminiResponse}\n"""\n\nClaude said:\n"""\n${claudeResponse}\n"""\n\nSynthesize the key points and provide a practical conclusion.`,
            },
          ];

          try {
            const stream3 = await (openai.chat.completions.create as any)({
              model: primaryChatgpt,
              models: chatgptModels,
              messages: seat3Messages,
              stream: true,
              max_tokens: 800,
              temperature: 0.7,
            });

            for await (const chunk of stream3) {
              if (chunk.model) {
                respondingChatgptModel = chunk.model;
              }
              const text = chunk.choices[0]?.delta?.content || '';
              if (text) {
                chatgptResponse += text;
                sendEvent('seat_chunk', {
                  seatId: 'chatgpt',
                  text: text,
                });
              }
            }

            console.log(
              `[Model Route] Provider: openai/ | Primary Requested: ${primaryChatgpt} | Responding Model: ${respondingChatgptModel}`
            );

            if (!chatgptResponse.trim()) {
              throw new Error('Received empty response from ChatGPT.');
            }

            sendEvent('seat_done', {
              seatId: 'chatgpt',
              modelId: respondingChatgptModel,
              content: chatgptResponse,
            });
          } catch (err3: any) {
            console.error('Error with ChatGPT:', err3);
            sendEvent('error', {
              seatId: 'chatgpt',
              message: `ChatGPT: ${err3?.message || 'Model request failed'}`,
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
