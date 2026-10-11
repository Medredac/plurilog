import type { SupabaseClient } from '@supabase/supabase-js';
import { videoMime } from './videoInputs';

/** Upload directly to private Storage in retryable chunks, never through a Next route. */
export async function uploadVideoResumable(
  client: SupabaseClient, path: string, file: File, signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<void> {
  signal.throwIfAborted();
  const { Upload } = await import('tus-js-client');
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Please sign in again to upload this video.');
  const endpoint = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (endpoint.hostname.endsWith('.supabase.co')) endpoint.hostname = endpoint.hostname.replace('.supabase.co', '.storage.supabase.co');
  endpoint.pathname = '/storage/v1/upload/resumable';
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const upload = new Upload(file, {
      endpoint: endpoint.toString(),
      headers: { authorization: `Bearer ${session.access_token}` },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      // A new storage path belongs to this send. Retry within it, never resume a
      // previous user's or abandoned message's upload from browser storage.
      storeFingerprintForResuming: false,
      metadata: { bucketName: 'message-images', objectName: path, contentType: videoMime(file.name)! },
      onProgress: (sent, total) => onProgress(Math.round(sent / total * 100)),
      onError: error => { cleanup(); reject(error); },
      onSuccess: () => { cleanup(); resolve(); },
    });
    const abort = () => {
      cleanup();
      void upload.abort().catch(() => undefined);
      reject(signal.reason || new DOMException('Upload cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    onProgress(0);
    upload.start();
  });
}
