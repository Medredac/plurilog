/**
 * Lossless, request-local transport for private document inputs. Canonical URLs
 * remain in messages/artifact state; only the outgoing OpenRouter body changes.
 * Never share this object between users or HTTP requests.
 */
const MIB = 1024 * 1024;

type TransportOptions = {
  supabaseUrl: string;
  requestSignal?: AbortSignal;
  fetchImpl?: typeof fetch;
  maxFileBytes?: number;
  maxCacheBytes?: number;
  maxBodyBytes?: number;
  onDiagnostic?: (event: Record<string, number | string>) => void;
};

type CachedFile = { bytes: Buffer; mime: string };
type JsonRecord = {
  messages?: Array<{ content?: string | Array<{
    type?: string;
    file?: Record<string, unknown>;
    image_url?: Record<string, unknown>;
  }> }>;
  modalities?: string[];
};

export function createRequestFileTransport(options: TransportOptions) {
  const upstreamFetch = options.fetchImpl || globalThis.fetch;
  const maxFileBytes = options.maxFileBytes ?? 40 * MIB;
  const maxCacheBytes = options.maxCacheBytes ?? 64 * MIB;
  const maxBodyBytes = options.maxBodyBytes ?? 64 * MIB;
  const cache = new Map<string, Promise<CachedFile | null>>();
  let retainedBytes = 0;
  let reservedBytes = 0;
  let downloads = 0;
  let cacheHits = 0;
  let urlFallbacks = 0;
  let providerUrlOnly = false;
  let origin: string | null = null;
  try {
    const url = new URL(options.supabaseUrl);
    if (url.protocol === 'https:') origin = url.origin;
  } catch { /* Missing configuration keeps the established URL transport. */ }

  function source(url: string): { key: string; mime: string } | null {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== origin || parsed.username || parsed.password) return null;
      const match = parsed.pathname.match(/^\/storage\/v1\/object\/(?:sign|public)\/message-images\/(.+)$/);
      if (!match || !match[1] || /%2f|%5c/i.test(match[1])) return null;
      // Only the signed token/download disposition may differ. Do not conflate
      // transformations or object versions with the original bytes.
      if ([...parsed.searchParams.keys()].some((key) => key !== 'token' && key !== 'download')) return null;
      const extension = match[1].split('.').pop()?.toLowerCase();
      const mime = ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[extension || ''];
      return mime ? { key: match[1], mime } : null;
    } catch { return null; }
  }

  function throwIfCancelled(signal?: AbortSignal | null) {
    options.requestSignal?.throwIfAborted();
    signal?.throwIfAborted();
  }

  // Seats share the download, but each seat owns only its wait. A seat timeout
  // must not poison the bytes needed by another seat or later memory indexing.
  async function waitForFile(pending: Promise<CachedFile | null>, signal?: AbortSignal | null) {
    const signals = [options.requestSignal, signal]
      .filter((value): value is AbortSignal => Boolean(value));
    if (!signals.length) return pending;
    const waitSignal = AbortSignal.any(signals);
    return new Promise<CachedFile | null>((resolve, reject) => {
      const stop = () => reject(waitSignal.reason);
      const cleanUp = () => waitSignal.removeEventListener('abort', stop);
      waitSignal.addEventListener('abort', stop, { once: true });
      if (waitSignal.aborted) stop();
      pending.then(
        (file) => { cleanUp(); resolve(file); },
        (error) => { cleanUp(); reject(error); }
      );
    });
  }

  // Seed only with original bytes already read by this authenticated request.
  function remember(url: string, bytes: Buffer): void {
    const entry = source(url);
    if (!entry || cache.has(entry.key) || cache.size >= 128 || !bytes.length ||
        bytes.length > maxFileBytes || retainedBytes + reservedBytes + bytes.length > maxCacheBytes) return;
    retainedBytes += bytes.length;
    cache.set(entry.key, Promise.resolve({ bytes, mime: entry.mime }));
  }

  async function read(url: string, signal?: AbortSignal | null): Promise<CachedFile | null> {
    throwIfCancelled(signal);
    const entry = source(url);
    if (!entry) return null;
    const existing = cache.get(entry.key);
    if (existing) {
      cacheHits++;
      const result = await waitForFile(existing, signal);
      throwIfCancelled(signal);
      return result;
    }
    const allowance = Math.min(maxFileBytes, maxCacheBytes - retainedBytes - reservedBytes);
    if (allowance <= 0 || cache.size >= 128) return null;
    reservedBytes += allowance;
    const pending = (async (): Promise<CachedFile | null> => {
      const signals = [options.requestSignal, AbortSignal.timeout(20_000)]
        .filter((value): value is AbortSignal => Boolean(value));
      try {
        const response = await upstreamFetch(url, {
          signal: AbortSignal.any(signals), redirect: 'error', credentials: 'omit',
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          return null;
        }
        const declaredLength = Number(response.headers.get('content-length') || 0);
        const contentType = response.headers.get('content-type')?.split(';')[0].trim();
        if (declaredLength > allowance || (contentType && contentType !== entry.mime && contentType !== 'application/octet-stream')) {
          await response.body.cancel();
          return null;
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > allowance) {
              await reader.cancel();
              return null;
            }
            chunks.push(next.value);
          }
        } finally { reader.releaseLock(); }
        throwIfCancelled();
        if (!size || (declaredLength > 0 && declaredLength !== size)) return null;
        const bytes = Buffer.concat(chunks, size);
        retainedBytes += size;
        downloads++;
        return { bytes, mime: entry.mime };
      } catch {
        throwIfCancelled();
        // A failed download must not remove the attachment or fail a working
        // URL-based model request. Do not log signed URLs or private filenames.
        return null;
      } finally { reservedBytes -= allowance; }
    })();
    cache.set(entry.key, pending);
    return waitForFile(pending, signal);
  }

  const transportFetch: typeof fetch = async (input, init) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (target === 'https://openrouter.ai/api/v1/chat/completions' && options.requestSignal) {
      init = { ...init, signal: init?.signal
        ? AbortSignal.any([options.requestSignal, init.signal])
        : options.requestSignal };
    }
    if (target !== 'https://openrouter.ai/api/v1/chat/completions' ||
        init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string' || providerUrlOnly) {
      return upstreamFetch(input, init);
    }
    throwIfCancelled(init.signal);
    let payload: JsonRecord;
    try { payload = JSON.parse(init.body); }
    catch { return upstreamFetch(input, init); }
    if (!Array.isArray(payload.messages)) return upstreamFetch(input, init);
    // Image-generation providers can have much smaller upload limits. This
    // transport is for document/vision input; their existing transport is kept.
    if (payload.modalities?.includes('image')) return upstreamFetch(input, init);

    let estimatedBodyBytes = Buffer.byteLength(init.body);
    let inlined = 0;
    let inlineBytes = 0;
    for (const message of payload.messages) {
      if (!Array.isArray(message?.content)) continue;
      for (const part of message.content) {
        const holder = part?.type === 'file' ? part.file : part?.type === 'image_url' ? part.image_url : null;
        const field = part?.type === 'file' ? 'file_data' : 'url';
        const url = holder?.[field];
        if (!holder || typeof url !== 'string' || !source(url)) continue;
        const file = await read(url, init.signal);
        if (!file) { urlFallbacks++; continue; }
        const encodedSize = 4 * Math.ceil(file.bytes.length / 3) + file.mime.length + 13;
        if (estimatedBodyBytes + encodedSize > maxBodyBytes) { urlFallbacks++; continue; }
        holder[field] = `data:${file.mime};base64,${file.bytes.toString('base64')}`;
        estimatedBodyBytes += encodedSize;
        inlined++;
        inlineBytes += file.bytes.length;
      }
    }
    throwIfCancelled(init.signal);
    options.onDiagnostic?.({ inlined, inlineBytes, downloads, cacheHits, retainedBytes, urlFallbacks });
    if (!inlined) return upstreamFetch(input, init);
    const headers = new Headers(init.headers);
    headers.delete('content-length');
    const response = await upstreamFetch(input, { ...init, headers, body: JSON.stringify(payload) });
    // Only replay a rejected, non-streaming input request. Never replay a
    // successful stream, timeout, rate limit or provider/tool error.
    if ([400, 413, 422].includes(response.status) && !response.headers.get('content-type')?.includes('text/event-stream')) {
      const errorText = (await response.clone().text()).slice(0, 8_192);
      if (response.status === 413 || /(?:base64|data[ -]?uri|data[ -]?url).{0,100}(?:unsupported|not supported|invalid|too large)|(?:request|payload|body).{0,50}(?:too large|size limit)/i.test(errorText)) {
        await response.body?.cancel();
        throwIfCancelled(init.signal);
        providerUrlOnly = true;
        options.onDiagnostic?.({ fallback: 'provider_rejected_inline', status: response.status });
        return upstreamFetch(input, init);
      }
    }
    return response;
  };

  return { fetch: transportFetch, remember, read };
}
