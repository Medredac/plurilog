import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/service';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Fail-safe cleanup for video uploads abandoned by cancelled/failed requests.
 * Normal successful video turns delete their files immediately. Vercel cron
 * runs on production only; preview deployments can call this route with the
 * preview CRON_SECRET if one is configured.
 */
export async function GET(request: NextRequest) {
  const token = process.env.CRON_SECRET;
  if (!token || request.headers.get('authorization') !== `Bearer ${token}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storage = createServiceClient().storage.from('message-images');
  const cutoff = Date.now() - 60 * 60 * 1000;
  let deleted = 0;
  let checkedUsers = 0;
  const errors: string[] = [];

  // Each video is kept beneath <owner UUID>/video-temp/<timestamp>-<uuid>.<ext>.
  // Use the Storage API to actually remove object bytes (not direct SQL deletes).
  for (let offset = 0; offset < 10_000; offset += 100) {
    const { data: users, error: listError } = await storage.list('', {
      limit: 100,
      offset,
    });
    if (listError) {
      errors.push(listError.message);
      break;
    }
    if (!users?.length) break;

    for (const entry of users) {
      if (!/^[a-f0-9-]{36}$/i.test(entry.name)) continue;
      checkedUsers++;
      const dir = `${entry.name}/video-temp`;
      // The video filenames start with millisecond timestamps, allowing
      // deterministic expiry without inspecting opaque video contents.
      const { data: videoFiles, error } = await storage.list(dir, { limit: 1000 });
      if (error) { errors.push(error.message); continue; }
      const oldFiles = (videoFiles || [])
        .filter(file => {
          const timestamp = Number(file.name.split('-')[0]);
          return Number.isFinite(timestamp) && timestamp > 0 && timestamp < cutoff;
        })
        .map(file => `${dir}/${file.name}`);
      if (!oldFiles.length) continue;
      const { error: deleteError } = await storage.remove(oldFiles);
      if (deleteError) errors.push(deleteError.message);
      else deleted += oldFiles.length;
    }
    if (users.length < 100) break;
  }

  return NextResponse.json({ deleted, checkedUsers, errors: errors.slice(0, 10) });
}
