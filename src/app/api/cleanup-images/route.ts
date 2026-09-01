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

    // 1. Fetch expired messages containing an image_url or attachment_urls
    const { data: expiredMessages, error: queryErr } = await supabase
      .from('messages')
      .select('id, image_url, attachment_urls, created_at')
      .or('image_url.not.is.null,attachment_urls.not.is.null')
      .lt('created_at', cutoffTime);

    if (queryErr) {
      console.error('[Cleanup Error] Error querying expired messages:', queryErr);
      return NextResponse.json(
        { error: 'Failed to query expired messages', details: queryErr.message },
        { status: 500 }
      );
    }

    // Filter to only messages that have at least one attachment
    const validExpiredMessages = (expiredMessages || []).filter((msg: any) => {
      const hasLegacy = Boolean(msg.image_url);
      const hasAttachments = Array.isArray(msg.attachment_urls) && msg.attachment_urls.length > 0;
      return hasLegacy || hasAttachments;
    });

    if (validExpiredMessages.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No expired attachments found (older than 48 hours).',
        processedCount: 0,
      });
    }

    const deletedFiles: string[] = [];
    const errors: any[] = [];

    // 2. Delete storage files and nullify image_url and attachment_urls on database rows
    for (const msg of validExpiredMessages) {
      try {
        const rawUrls: string[] = [];
        if (msg.image_url) {
          rawUrls.push(msg.image_url);
        }
        if (Array.isArray(msg.attachment_urls)) {
          for (const url of msg.attachment_urls) {
            if (url) {
              rawUrls.push(url);
            }
          }
        }

        const filePaths: string[] = [];
        for (const url of rawUrls) {
          const bucketIndex = url.indexOf('message-images/');
          if (bucketIndex !== -1) {
            const rawPath = url.slice(bucketIndex + 'message-images/'.length).split('?')[0];
            const decodedPath = decodeURIComponent(rawPath);
            if (decodedPath && !filePaths.includes(decodedPath)) {
              filePaths.push(decodedPath);
            }
          }
        }

        if (filePaths.length > 0) {
          const { error: removeErr } = await supabase.storage
            .from('message-images')
            .remove(filePaths);

          if (removeErr) {
            console.warn(`[Cleanup Warning] Could not remove files from storage for message ${msg.id}:`, removeErr, { filePaths });
            errors.push({ id: msg.id, error: removeErr.message });
            continue;
          } else {
            deletedFiles.push(...filePaths);
          }
        }

        // Set image_url and attachment_urls to null on message row while preserving text content
        const { error: updateErr } = await supabase
          .from('messages')
          .update({ image_url: null, attachment_urls: null })
          .eq('id', msg.id);

        if (updateErr) {
          console.error(`[Cleanup Error] Failed to nullify attachments on message ${msg.id}:`, updateErr);
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
      totalExpired: validExpiredMessages.length,
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
