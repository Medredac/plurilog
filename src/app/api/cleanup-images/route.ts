import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * 48-Hour Image Cleanup Route
 *
 * Scans the messages table for any rows with an attached image older than 48 hours.
 * Deletes the corresponding file from the 'message-images' storage bucket
 * and sets `image_url` to null while leaving the message text content untouched.
 *
 * Can be triggered periodically by cron-job.org, GitHub Actions, or Vercel Cron.
 */
export async function GET(req: NextRequest) {
  return handleCleanup(req);
}

export async function POST(req: NextRequest) {
  return handleCleanup(req);
}

async function handleCleanup(req: NextRequest) {
  try {
    // Optional secret verification if CRON_SECRET is configured
    const authHeader = req.headers.get('authorization');
    const secretQuery = req.nextUrl.searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret) {
      const isAuthValid =
        authHeader === `Bearer ${cronSecret}` || secretQuery === cronSecret;
      if (!isAuthValid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase credentials are not configured.' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 48 hours ago cutoff timestamp
    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // 1. Fetch expired messages containing an image_url
    const { data: expiredMessages, error: queryErr } = await supabase
      .from('messages')
      .select('id, image_url, created_at')
      .not('image_url', 'is', null)
      .lt('created_at', cutoffTime);

    if (queryErr) {
      console.error('[Cleanup Error] Error querying expired messages:', queryErr);
      return NextResponse.json(
        { error: 'Failed to query expired messages', details: queryErr.message },
        { status: 500 }
      );
    }

    if (!expiredMessages || expiredMessages.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No expired images found (older than 48 hours).',
        processedCount: 0,
      });
    }

    const deletedFiles: string[] = [];
    const errors: any[] = [];

    // 2. Delete storage files and nullify image_url on database rows
    for (const msg of expiredMessages) {
      if (!msg.image_url) continue;

      try {
        // Extract relative storage path inside 'message-images' bucket
        // Format typically: .../message-images/{userId}/{timestamp}-{filename}
        const bucketIndex = msg.image_url.indexOf('/message-images/');
        let filePath = '';
        if (bucketIndex !== -1) {
          filePath = decodeURIComponent(
            msg.image_url.slice(bucketIndex + '/message-images/'.length).split('?')[0]
          );
        }

        if (filePath) {
          const { error: removeErr } = await supabase.storage
            .from('message-images')
            .remove([filePath]);

          if (removeErr) {
            console.warn(`[Cleanup Warning] Could not remove file ${filePath} from storage:`, removeErr);
          } else {
            deletedFiles.push(filePath);
          }
        }

        // Set image_url to null on message row while preserving text content
        const { error: updateErr } = await supabase
          .from('messages')
          .update({ image_url: null })
          .eq('id', msg.id);

        if (updateErr) {
          console.error(`[Cleanup Error] Failed to nullify image_url on message ${msg.id}:`, updateErr);
          errors.push({ id: msg.id, error: updateErr.message });
        }
      } catch (msgEx: any) {
        console.error(`[Cleanup Exception] Error cleaning message ${msg.id}:`, msgEx);
        errors.push({ id: msg.id, error: msgEx?.message });
      }
    }

    return NextResponse.json({
      success: true,
      cutoffTime,
      totalExpired: expiredMessages.length,
      deletedFilesCount: deletedFiles.length,
      errorsCount: errors.length,
      deletedFiles,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('[Cleanup Exception] Top-level cleanup error:', err);
    return NextResponse.json(
      { error: 'Internal cleanup error', details: err?.message },
      { status: 500 }
    );
  }
}
