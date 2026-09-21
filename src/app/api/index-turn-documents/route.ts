import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import OpenAI from 'openai';
import {
  extractStoragePathFromSignedUrl,
  indexStoredDiscussionDocuments,
  ingestDiscussionDocuments,
} from '@/utils/discussionMemory';
import { verifyDiscussionOwnership } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface IndexAttachment {
  url: string;
  filename: string;
}

function isPdfAttachment(att: IndexAttachment): boolean {
  const cleanUrl = String(att?.url || '').split('?')[0].split('#')[0].toLowerCase();
  const cleanName = String(att?.filename || '').toLowerCase();
  return cleanUrl.endsWith('.pdf') || cleanName.endsWith('.pdf');
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  try {
    const body = await req.json();
    const discussionId =
      typeof body?.discussionId === 'string' ? body.discussionId.trim() : '';
    const sourceUserMessageId =
      typeof body?.sourceUserMessageId === 'string'
        ? body.sourceUserMessageId.trim()
        : '';
    const rawAttachments = Array.isArray(body?.attachments)
      ? body.attachments
      : [];

    if (!discussionId || !sourceUserMessageId) {
      return NextResponse.json(
        { error: 'discussionId and sourceUserMessageId are required.' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Route handlers may not always allow response cookie mutation.
            }
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const isOwner = await verifyDiscussionOwnership(supabase, discussionId);
    if (!isOwner) {
      return NextResponse.json({ error: 'Discussion not found.' }, { status: 404 });
    }

    const { data: sourceMessage, error: sourceMessageError } = await supabase
      .from('messages')
      .select('id, discussion_id, sender, attachment_urls')
      .eq('id', sourceUserMessageId)
      .eq('discussion_id', discussionId)
      .eq('sender', 'user')
      .maybeSingle();

    if (sourceMessageError || !sourceMessage) {
      return NextResponse.json(
        { error: 'Source user message not found.' },
        { status: 404 }
      );
    }

    const allowedStoragePaths = new Set(
      (Array.isArray(sourceMessage.attachment_urls)
        ? sourceMessage.attachment_urls
        : []
      )
        .map((url: string) => extractStoragePathFromSignedUrl(url))
        .filter(
          (path: string | null): path is string =>
            Boolean(path) && path!.startsWith(`${user.id}/`)
        )
    );

    const pdfAttachments: IndexAttachment[] = rawAttachments
      .filter(
        (att: any): att is IndexAttachment =>
          Boolean(att) &&
          typeof att.url === 'string' &&
          typeof att.filename === 'string' &&
          isPdfAttachment(att)
      )
      .filter((att: IndexAttachment) => {
        const path = extractStoragePathFromSignedUrl(att.url);
        return Boolean(path && allowedStoragePaths.has(path));
      });

    const storagePaths = Array.from(
      new Set(
        pdfAttachments
          .map((att) => extractStoragePathFromSignedUrl(att.url))
          .filter((path): path is string => Boolean(path))
      )
    );

    if (storagePaths.length === 0) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'no_authorized_pdf_attachments',
        elapsedMs: Date.now() - startedAt,
      });
    }

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY is not configured.' },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://plurilog.app',
        'X-Title': 'Plurilog',
      },
    });

    const serviceClient = createServiceClient();

    const { data: existingSources, error: sourceLookupError } =
      await serviceClient
        .from('discussion_document_sources')
        .select('storage_path')
        .eq('discussion_id', discussionId)
        .in('storage_path', storagePaths);

    if (sourceLookupError) {
      throw new Error(
        `Failed to inspect staged document sources: ${sourceLookupError.message}`
      );
    }

    const stagedPaths = new Set(
      (existingSources || [])
        .map((row: any) => row?.storage_path)
        .filter((path: unknown): path is string => typeof path === 'string')
    );
    const missingAttachments = pdfAttachments.filter((att) => {
      const path = extractStoragePathFromSignedUrl(att.url);
      return Boolean(path && !stagedPaths.has(path));
    });

    let fallbackOcrCount = 0;
    let stagingResult: any = null;

    // If the live panel did not emit reusable parser annotations (for example,
    // native visual PDF inspection), do the fallback OCR here in this separate
    // invocation rather than consuming the live /api/debate time budget.
    if (missingAttachments.length > 0 && !req.signal.aborted) {
      console.log('[Doc Index] Running deferred fallback OCR:', {
        discussionId,
        sourceUserMessageId,
        pdfCount: missingAttachments.length,
      });

      const ocrBlocks = missingAttachments.map((att) => ({
        type: 'file',
        file: {
          filename: att.filename || 'attachment.pdf',
          file_data: att.url,
        },
      }));

      const stream = await (openai.chat.completions.create as any)({
        model: 'google/gemini-3.7-flash',
        messages: [
          {
            role: 'user',
            content: [...ocrBlocks, { type: 'text', text: 'Extract index.' }],
          },
        ],
        plugins: [
          {
            id: 'file-parser',
            pdf: { engine: 'mistral-ocr' },
          },
        ],
        stream: true,
        max_tokens: 10,
        signal: req.signal,
      });

      const captured: any[] = [];
      for await (const chunk of stream) {
        const anns = (chunk.choices?.[0]?.delta as any)?.annotations;
        if (!anns) continue;
        const annList = Array.isArray(anns) ? anns : [anns];
        for (const ann of annList) {
          if (
            ann?.type === 'file' &&
            ann?.file?.hash &&
            !captured.some((existing) => existing?.file?.hash === ann.file.hash)
          ) {
            captured.push(ann);
          }
        }
      }

      fallbackOcrCount = captured.length;
      if (captured.length > 0) {
        stagingResult = await ingestDiscussionDocuments({
          serviceSupabase: serviceClient,
          openai,
          discussionId,
          fileAnnotations: captured,
          attachments: missingAttachments,
          sourceUserMessageId,
          signal: req.signal,
          deferEmbedding: true,
        });
      }
    }

    const indexResult = await indexStoredDiscussionDocuments({
      serviceSupabase: serviceClient,
      openai,
      discussionId,
      storagePaths,
      signal: req.signal,
    });

    console.log('[Doc Index] Post-relay indexing complete:', {
      discussionId,
      sourceUserMessageId,
      requestedPdfCount: storagePaths.length,
      fallbackOcrCount,
      matchedCount: indexResult.matchedCount,
      indexedCount: indexResult.indexedCount,
      skippedCount: indexResult.skippedCount,
      errorCount: indexResult.errors.length,
      elapsedMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      requestedPdfCount: storagePaths.length,
      fallbackOcrCount,
      stagingResult,
      indexResult,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err: any) {
    console.error('[Doc Index] Post-relay indexing request failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Document indexing failed.' },
      { status: 500 }
    );
  }
}
