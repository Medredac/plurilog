import { Sandbox } from '@vercel/sandbox';
import { VIDEO_INLINE_MAX_BYTES, VIDEO_MAX_BYTES, validateVideoRange, type VideoRange } from './videoInputs';
import type { VideoSource } from './videoInspection';

const SEGMENT_SECONDS = 90;

export function videoWindows(duration: number, range: VideoRange): Array<{ start: number; end: number }> {
  validateVideoRange(range);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video has no readable duration.');
  const start = range.startSeconds ?? 0;
  const end = Math.min(range.endSeconds ?? duration, duration);
  if (start >= end) throw new Error('The requested timestamp is outside this video.');
  if (end - start > 3 * 60 * 60) throw new Error('Inspect up to three hours at a time. Choose a time range for this longer video.');
  const windows = [];
  for (let offset = start; offset < end; offset += SEGMENT_SECONDS) windows.push({ start: offset, end: Math.min(offset + SEGMENT_SECONDS, end) });
  return windows;
}

// Python streams the original straight to the isolated VM's disk. The Next
// process never buffers a 500 MB original or a base64 version of it.
const DOWNLOAD = String.raw`
import json, urllib.request, os, sys
try:
    c=json.load(open('/vercel/sandbox/input.json'))
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args): raise ValueError('Unexpected storage redirect')
    with urllib.request.build_opener(NoRedirect).open(c['url'], timeout=120) as r, open('/vercel/sandbox/original','wb') as f:
        if int(r.headers.get('Content-Length','0')) > c['maxBytes']: raise ValueError('Video exceeds upload limit')
        n=0
        while True:
            b=r.read(1024*1024)
            if not b: break
            n+=len(b)
            if n > c['maxBytes']: raise ValueError('Video exceeds upload limit')
            f.write(b)
    if not n: raise ValueError('Empty video')
    os.remove('/vercel/sandbox/input.json')
except Exception as e:
    print(type(e).__name__ + ':' + str(getattr(e, 'code', '')), flush=True)
    sys.exit(1)
`;

async function checked(sandbox: Sandbox, cmd: string, args: string[], label: string, sudo = false) {
  const result = await sandbox.runCommand({ cmd, args, sudo });
  // Do not propagate command stderr: it may contain the private storage URL.
  if (result.exitCode !== 0) {
    if (cmd === 'python3') console.error('[Video Download Failure]', { exitCode: result.exitCode, category: (await result.stdout()).trim().slice(0, 80) });
    throw new Error(label);
  }
  return result;
}

export async function inspectPreparedVideo(options: {
  signedUrl: string; filename: string; question: string; range: VideoRange;
  signal: AbortSignal;
  analyze: (source: VideoSource, signal: AbortSignal) => Promise<{ findings: string; model: string }>;
}): Promise<{ findings: string; model: string }> {
  validateVideoRange(options.range);
  options.signal.throwIfAborted();
  const snapshotId = process.env.VIDEO_PROCESSOR_SNAPSHOT_ID;
  const settings = { persistent: false, timeout: 900_000, resources: { vcpus: 2 }, networkPolicy: 'allow-all' as const };
  let sandbox: Sandbox;
  let readyProcessor = false;
  if (snapshotId) {
    try {
      sandbox = await Sandbox.create({ ...settings, source: { type: 'snapshot', snapshotId } });
      readyProcessor = true;
    } catch {
      options.signal.throwIfAborted();
      sandbox = await Sandbox.create({ ...settings, image: 'vercel/sandbox/universal' });
    }
  } else sandbox = await Sandbox.create({ ...settings, image: 'vercel/sandbox/universal' });
  const abort = () => { void sandbox.stop().catch(() => undefined); };
  options.signal.addEventListener('abort', abort, { once: true });
  try {
    options.signal.throwIfAborted();
    if (!readyProcessor) await checked(sandbox, 'bash', ['-c', 'apt-get update -qq && apt-get install -y -qq ffmpeg'], 'Video preparation is temporarily unavailable.', true);
    await sandbox.writeFiles([
      { path: '/vercel/sandbox/input.json', content: Buffer.from(JSON.stringify({ url: options.signedUrl, maxBytes: VIDEO_MAX_BYTES })) },
      { path: '/vercel/sandbox/download.py', content: Buffer.from(DOWNLOAD) },
    ]);
    await checked(sandbox, 'python3', ['/vercel/sandbox/download.py'], 'Could not download this video for analysis. Please retry.');
    // Media parsers cannot access the network, even if a crafted file references URLs.
    await sandbox.update({ networkPolicy: 'deny-all' });
    const probe = await checked(sandbox, 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', '/vercel/sandbox/original'], 'This video could not be decoded. Try exporting it as an MP4.');
    const metadata = JSON.parse(await probe.stdout());
    if (!metadata.streams?.some((stream: { codec_type: string }) => stream.codec_type === 'video')) throw new Error('This file contains no video track.');
    const duration = Number(metadata.format?.duration);
    const windows = videoWindows(duration, options.range);
    const findings: string[] = [];
    const models = new Set<string>();
    for (let i = 0; i < windows.length; i++) {
      options.signal.throwIfAborted();
      const window = windows[i];
      await checked(sandbox, 'ffmpeg', [
        '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe',
        '-ss', String(window.start), '-i', '/vercel/sandbox/original', '-t', String(window.end - window.start),
        '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
        '-vf', "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
        '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '900k', '-bufsize', '1800k',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-b:a', '64k', '-movflags', '+faststart', '/vercel/sandbox/analysis.mp4',
      ], 'Could not prepare this video for analysis. Try exporting it as an MP4.');
      const bytes = await sandbox.readFileToBuffer({ path: '/vercel/sandbox/analysis.mp4' });
      if (!bytes?.length || bytes.length > VIDEO_INLINE_MAX_BYTES) throw new Error('The analysis copy was too large. Try asking about a shorter time range.');
      const result = await options.analyze({
        url: `data:video/mp4;base64,${bytes.toString('base64')}`, label: options.filename, youtube: false,
        question: `${options.question}\nThis is a temporary analysis copy covering original seconds ${window.start}–${window.end} of a ${duration}-second video. Clip time zero is original second ${window.start}; report timestamps on the ORIGINAL timeline. It is reduced to at most 720p, 30 FPS, with compressed mono audio. Do not infer unreadable fine details. Describe evidence relevant to the question from this section only.`,
      }, options.signal);
      if (!result.findings.trim()) throw new Error('Video inspection returned no findings. Please retry.');
      findings.push(`[Original seconds ${window.start}–${window.end}]\n${result.findings}`);
      models.add(result.model);
    }
    return { findings: `Inspected original seconds ${windows[0].start}–${windows[windows.length - 1].end} of ${duration}. Analysis used temporary compressed copies.\n\n${findings.join('\n\n')}`, model: [...models].join(', ') };
  } finally {
    options.signal.removeEventListener('abort', abort);
    // Ephemeral disk, including original and analysis copies, is discarded.
    await sandbox.stop().catch(() => undefined);
  }
}
