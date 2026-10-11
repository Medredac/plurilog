import { Sandbox } from '@vercel/sandbox';
import { createClient } from '@/utils/supabase/server';
import { inspectStoredVideo, validateStoredVideoBudget } from '@/utils/storedVideoInspection';
import { createVideoInspectionSession, inspectVideoWithModel } from '@/utils/videoInspection';
import { PROVIDER_MODELS } from '@/utils/openrouter';
import OpenAI from 'openai';

export const maxDuration = 900;
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview') return new Response(null, { status: 404 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  const body = await request.json();
  try {
    if (body.action === 'snapshot') {
      const sandbox = await Sandbox.create({ image: 'vercel/sandbox/universal', persistent: false, timeout: 300_000 });
      try {
        const install = await sandbox.runCommand({ cmd: 'bash', args: ['-c', 'apt-get update -qq && apt-get install -y -qq ffmpeg'], sudo: true });
        if (install.exitCode !== 0) throw new Error('ffmpeg installation failed');
        const snapshot = await sandbox.snapshot();
        return Response.json({ snapshotId: snapshot.snapshotId });
      } finally { await sandbox.stop().catch(() => undefined); }
    }
    const attachments = body.files as Array<{ filename: string; path: string }>;
    if (!Array.isArray(attachments) || attachments.length > 5) throw new Error('Invalid files');
    const urls = attachments.map(file => ({ filename: file.filename, url: `/api/attachments/message-images/${file.path}#filename=${encodeURIComponent(file.filename)}` }));
    await validateStoredVideoBudget(urls, user.id);
    const ai = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY });
    let analysisCalls = 0;
    const session = createVideoInspectionSession({ userId: user.id, prompt: '', rounds: [], currentAttachments: urls, signal: request.signal,
      readUpload: async () => { throw new Error('Unexpected legacy reader'); },
      analyze: async () => { throw new Error('Unexpected standalone call'); },
      inspectUpload: (path, filename, question, range, signal) => inspectStoredVideo({ path, filename, question, range, signal, userId: user.id,
        analyze: (source, signal) => { analysisCalls++; return inspectVideoWithModel((data, opts) => ai.chat.completions.create(data, opts), PROVIDER_MODELS['google/'], source, signal); },
      }),
    });
    const results = [];
    for (const file of attachments) {
      const first = await session.inspect({ filename: file.filename, question: 'Describe the visible colors and shapes at the start and end. Do not infer content from the filename.' });
      const repeated = await session.inspect({ filename: file.filename, question: 'Inspect it again.' });
      results.push({ first: first.result, repeated: repeated.result.status });
      if (!first.result.ok) throw new Error(String(first.result.error));
    }
    const { data: discussion, error } = await client.from('discussions').insert({ user_id: user.id, title: 'Large video upload verification', updated_at: new Date().toISOString() }).select('id').single();
    if (error) throw error;
    const { error: messageError } = await client.from('messages').insert({ discussion_id: discussion.id, sender: 'user', content: 'These two videos were uploaded for one-time analysis verification.', attachment_urls: urls.map(file => file.url) });
    if (messageError) throw messageError;
    await client.from('messages').insert({ discussion_id: discussion.id, sender: 'gemini', content: results.map(result => result.first.findings).join('\n\n') });
    return Response.json({ ok: true, results, analysisCalls, discussionId: discussion.id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Verification failed' }, { status: 400 }); }
}
