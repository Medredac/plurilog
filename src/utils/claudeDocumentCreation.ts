import { ModelId } from '@/types/chat';
import { createServiceClient } from '@/utils/supabase/service';
import { ingestParsedDocument } from '@/utils/discussionMemory';
import { persistGeneratedDocument } from '@/utils/generatedDocumentStorage';
import { renderDocx } from '@/utils/docxWriter';
import type { StructuredDocxInput } from '@/utils/docxWriter';

export interface ClaudeCreateFileArgs extends StructuredDocxInput {
  format: 'docx';
}

export interface ExecuteClaudeDocumentCreationOptions {
  supabase: any;
  openai: any;
  discussionId: string;
  messageId: string;
  seatId: ModelId;
  args: ClaudeCreateFileArgs;
  signal?: AbortSignal;
}

export interface ExecuteClaudeDocumentCreationResult {
  finalContent: string;
  messageId: string;
  createdAt: string;
  filename: string;
  storagePath: string;
  signedUrl: string;
  durableUrl: string;
  fullText: string;
}

export async function executeClaudeDocumentCreation(
  options: ExecuteClaudeDocumentCreationOptions
): Promise<ExecuteClaudeDocumentCreationResult> {
  const {
    supabase,
    openai,
    discussionId,
    messageId,
    seatId,
    args,
    signal,
  } = options;

  if (seatId !== 'claude') {
    throw new Error('Only Claude can create downloadable documents in this rollout.');
  }
  if (!discussionId) {
    throw new Error('A discussion is required for document creation.');
  }
  if (!args || args.format !== 'docx') {
    throw new Error('DOCX is the only supported generated file format in this rollout.');
  }

  const renderedDocument = renderDocx({
    filename: args.filename,
    title: args.title,
    blocks: args.blocks,
  });
  const finalContent = `Created **${renderedDocument.filename}**.`;

  let persistedMsg: { id: string; created_at: string } | null = null;
  let insertedFresh = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        id: messageId,
        discussion_id: discussionId,
        sender: seatId,
        content: finalContent,
      })
      .select('id, created_at, discussion_id, sender, content')
      .maybeSingle();

    if (!error && data) {
      persistedMsg = { id: data.id, created_at: data.created_at };
      insertedFresh = true;
      break;
    }

    if (error?.code === '23505') {
      const { data: existing, error: fetchErr } = await supabase
        .from('messages')
        .select('id, created_at, discussion_id, sender, content')
        .eq('id', messageId)
        .maybeSingle();

      if (
        !fetchErr &&
        existing &&
        existing.id === messageId &&
        existing.discussion_id === discussionId &&
        existing.sender === seatId &&
        existing.content === finalContent
      ) {
        persistedMsg = { id: existing.id, created_at: existing.created_at };
      }
      break;
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  if (!persistedMsg) {
    throw new Error('Failed to persist Claude document response.');
  }

  let persistedDocument;
  try {
    persistedDocument = await persistGeneratedDocument({
      supabase,
      discussionId,
      messageId: persistedMsg.id,
      seatId,
      fileBuffer: renderedDocument.buffer,
      filename: renderedDocument.filename,
    });
  } catch (err) {
    if (insertedFresh) {
      try {
        await supabase
          .from('messages')
          .delete()
          .eq('id', persistedMsg.id)
          .eq('discussion_id', discussionId)
          .eq('sender', seatId)
          .eq('content', finalContent);
      } catch (cleanupErr) {
        console.warn(
          '[Generated Document] Failed to clean up message after storage error:',
          cleanupErr
        );
      }
    }
    throw err;
  }

  // Indexing is deliberately non-critical to file creation. The user should still
  // receive the successfully created file if embeddings are temporarily unavailable.
  try {
    const serviceClient = createServiceClient();
    const ingestResult = await ingestParsedDocument({
      serviceSupabase: serviceClient,
      openai,
      discussionId,
      filename: persistedDocument.filename,
      fullText: renderedDocument.fullText,
      fileBytes: renderedDocument.buffer,
      storagePath: persistedDocument.storagePath,
      signal,
    });

    console.log('[Generated Document Ingest]', {
      discussionId,
      filename: persistedDocument.filename,
      ingestedCount: ingestResult.ingestedCount,
      skippedCount: ingestResult.skippedCount,
      errorCount: ingestResult.errors.length,
    });
  } catch (docIngestErr) {
    console.warn(
      '[Generated Document Ingest] Non-critical indexing error:',
      docIngestErr
    );
  }

  return {
    finalContent,
    messageId: persistedMsg.id,
    createdAt: persistedMsg.created_at,
    filename: persistedDocument.filename,
    storagePath: persistedDocument.storagePath,
    signedUrl: persistedDocument.signedUrl,
    durableUrl: persistedDocument.durableUrl,
    fullText: renderedDocument.fullText,
  };
}
