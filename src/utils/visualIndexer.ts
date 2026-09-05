import crypto from "crypto";
import { prepareGeminiVisionAttachments } from "./geminiVision";
import {
  isImageUrl,
  isPdfUrl,
  extractStoragePathFromSignedUrl,
  extractAttachmentMetadata,
} from "./discussionMemory";

export interface VisualDescriptorJson {
  scene: string;
  image_type: "photo" | "screenshot" | "diagram" | "scan" | "document_photo" | "other";
  people_count: number | null;
  objects: string[];
  colors: string[];
  visible_text: string[];
  details: string[];
}

export interface IndexDiscussionImageArtifactsParams {
  serviceSupabase: any;
  openai: any;
  discussionId: string;
  attachments?: Array<{ url: string; filename?: string }> | null;
  signal?: AbortSignal;
}

export interface IndexDiscussionImageArtifactsResult {
  indexedCount: number;
  skippedCount: number;
  errors: Array<{
    artifactId?: string;
    filename?: string;
    error: string;
  }>;
}

export const ALLOWED_IMAGE_TYPES = [
  "photo",
  "screenshot",
  "diagram",
  "scan",
  "document_photo",
  "other",
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const STALE_LEASE_SECONDS = 90;

/**
 * Resolves the storage path from an attachment URL, supporting Supabase signed URLs, relative paths, and direct paths.
 */
export function resolveStoragePathFromAttachment(url?: string | null): string | null {
  if (!url || typeof url !== "string") return null;
  const signedExtracted = extractStoragePathFromSignedUrl(url);
  if (signedExtracted) return signedExtracted;
  const meta = extractAttachmentMetadata(url);
  if (meta?.storagePath) return meta.storagePath;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return url.split("?")[0];
  }
  try {
    const parsed = new URL(url);
    const cleanPath = parsed.pathname.replace(/^\/+/, "");
    return cleanPath || null;
  } catch {
    return url.split("?")[0] || null;
  }
}

/**
 * Deterministically formats structured visual descriptor JSON into searchable text.
 */
export function formatDescriptorText(desc: VisualDescriptorJson): string {
  const parts: string[] = [];
  if (desc.scene && desc.scene.trim()) {
    parts.push(`Scene: ${desc.scene.trim()}`);
  }
  if (desc.image_type && desc.image_type.trim()) {
    parts.push(`Image Type: ${desc.image_type.trim()}`);
  }
  if (typeof desc.people_count === "number" && desc.people_count >= 0) {
    parts.push(`People Count: ${desc.people_count}`);
  }
  if (Array.isArray(desc.objects) && desc.objects.length > 0) {
    const cleaned = desc.objects.map((o) => o.trim()).filter(Boolean);
    if (cleaned.length > 0) {
      parts.push(`Objects: ${cleaned.join(", ")}`);
    }
  }
  if (Array.isArray(desc.colors) && desc.colors.length > 0) {
    const cleaned = desc.colors.map((c) => c.trim()).filter(Boolean);
    if (cleaned.length > 0) {
      parts.push(`Colors: ${cleaned.join(", ")}`);
    }
  }
  if (Array.isArray(desc.visible_text) && desc.visible_text.length > 0) {
    const cleaned = desc.visible_text.map((t) => t.trim()).filter(Boolean);
    if (cleaned.length > 0) {
      parts.push(`Visible Text: ${cleaned.join(", ")}`);
    }
  }
  if (Array.isArray(desc.details) && desc.details.length > 0) {
    const cleaned = desc.details.map((d) => d.trim()).filter(Boolean);
    if (cleaned.length > 0) {
      parts.push(`Details: ${cleaned.join(", ")}`);
    }
  }
  return parts.join("\n");
}

/**
 * Validates and sanitizes raw model output against the approved compact visual descriptor schema and bounds.
 */
export function validateAndSanitizeDescriptor(raw: any): VisualDescriptorJson | null {
  if (!raw || typeof raw !== "object") return null;

  // 1. Scene: required non-empty string, max 300 chars
  if (typeof raw.scene !== "string" || !raw.scene.trim()) {
    return null;
  }
  const scene = raw.scene.trim().slice(0, 300);

  // 2. Image Type: must match allowed enum, fallback to other
  let image_type: AllowedImageType = "other";
  if (typeof raw.image_type === "string") {
    const candidate = raw.image_type.toLowerCase().trim() as AllowedImageType;
    if (ALLOWED_IMAGE_TYPES.includes(candidate)) {
      image_type = candidate;
    }
  }

  // 3. People Count: non-negative integer or null (DO NOT default unknown to 0)
  let people_count: number | null = null;
  if (
    typeof raw.people_count === "number" &&
    Number.isFinite(raw.people_count) &&
    Number.isInteger(raw.people_count) &&
    raw.people_count >= 0
  ) {
    people_count = raw.people_count;
  }

  // 4. Objects: array of strings, max 15 items, max 50 chars each
  const objects: string[] = [];
  if (Array.isArray(raw.objects)) {
    for (const obj of raw.objects) {
      if (typeof obj === "string" && obj.trim()) {
        objects.push(obj.trim().slice(0, 50));
        if (objects.length >= 15) break;
      }
    }
  }

  // 5. Colors: array of strings, max 8 items, max 30 chars each
  const colors: string[] = [];
  if (Array.isArray(raw.colors)) {
    for (const col of raw.colors) {
      if (typeof col === "string" && col.trim()) {
        colors.push(col.trim().slice(0, 30));
        if (colors.length >= 8) break;
      }
    }
  }

  // 6. Visible Text: string[] snippets, max 10 snippets, max 80 chars each, max 500 chars total
  const visible_text: string[] = [];
  let totalVisibleChars = 0;
  if (Array.isArray(raw.visible_text)) {
    for (const snip of raw.visible_text) {
      if (typeof snip === "string" && snip.trim()) {
        const trimmed = snip.trim().slice(0, 80);
        if (totalVisibleChars + trimmed.length <= 500) {
          visible_text.push(trimmed);
          totalVisibleChars += trimmed.length;
        } else {
          const remaining = 500 - totalVisibleChars;
          if (remaining > 0) {
            visible_text.push(trimmed.slice(0, remaining));
            totalVisibleChars = 500;
          }
          break;
        }
        if (visible_text.length >= 10) break;
      }
    }
  } else if (typeof raw.visible_text === "string" && raw.visible_text.trim()) {
    const trimmed = raw.visible_text.trim().slice(0, Math.min(80, 500));
    visible_text.push(trimmed);
  }

  // 7. Details: string[], max 6 items, max 100 chars each
  const details: string[] = [];
  if (Array.isArray(raw.details)) {
    for (const d of raw.details) {
      if (typeof d === "string" && d.trim()) {
        details.push(d.trim().slice(0, 100));
        if (details.length >= 6) break;
      }
    }
  } else if (typeof raw.details === "string" && raw.details.trim()) {
    details.push(raw.details.trim().slice(0, 100));
  }

  return {
    scene,
    image_type,
    people_count,
    objects,
    colors,
    visible_text,
    details,
  };
}

/**
 * Indexes standalone image attachments for a discussion using the approved Phase 3A architecture.
 * Operates post-relay inside its own try/catch without blocking or invalidating panel delivery.
 */
export async function indexDiscussionImageArtifacts(
  params: IndexDiscussionImageArtifactsParams
): Promise<IndexDiscussionImageArtifactsResult> {
  const result: IndexDiscussionImageArtifactsResult = {
    indexedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  const { serviceSupabase, openai, discussionId, attachments, signal } = params;

  if (
    !serviceSupabase ||
    !openai ||
    !discussionId ||
    !attachments ||
    !Array.isArray(attachments) ||
    attachments.length === 0 ||
    signal?.aborted
  ) {
    return result;
  }

  // 1. Filter to standalone image candidates only (explicitly bypass PDFs and non-images)
  const imageAttachments = attachments.filter((att) => {
    if (!att || !att.url) return false;
    if (isPdfUrl(att.url, att.filename)) return false;
    return isImageUrl(att.url, att.filename);
  });

  if (imageAttachments.length === 0) {
    return result;
  }

  try {
    // 2. Resolve canonical artifact IDs through existing discussion_artifact_sources
    const storagePaths: string[] = [];
    for (const att of imageAttachments) {
      const storagePath = resolveStoragePathFromAttachment(att.url);
      if (storagePath && !storagePaths.includes(storagePath)) {
        storagePaths.push(storagePath);
      }
    }

    if (storagePaths.length === 0) {
      return result;
    }

    const { data: sourceRows, error: srcFetchErr } = await serviceSupabase
      .from("discussion_artifact_sources")
      .select("artifact_id, storage_path, filename, created_at")
      .eq("discussion_id", discussionId)
      .in("storage_path", storagePaths);

    if (srcFetchErr) {
      console.warn("[Visual Indexer] Error querying discussion_artifact_sources:", srcFetchErr);
      result.errors.push({ error: srcFetchErr.message || "Failed to query artifact sources" });
      return result;
    }

    if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
      return result;
    }

    const uniqueArtifactIds = Array.from(new Set(sourceRows.map((r: any) => r.artifact_id).filter(Boolean)));

    for (const artifactId of uniqueArtifactIds) {
      if (signal?.aborted) break;
      try {
        await processSingleArtifactIndexing({
          serviceSupabase,
          openai,
          discussionId,
          artifactId: artifactId as string,
          signal,
          result,
        });
      } catch (itemErr: any) {
        console.warn(`[Visual Indexer] Unexpected error indexing artifact ${artifactId}:`, itemErr);
        result.errors.push({
          artifactId: artifactId as string,
          error: itemErr?.message || String(itemErr),
        });
      }
    }
  } catch (outerErr: any) {
    console.error("[Visual Indexer] Non-critical outer error in indexDiscussionImageArtifacts:", outerErr);
    result.errors.push({ error: outerErr?.message || "Outer visual indexing error" });
  }

  return result;
}

interface ProcessSingleArtifactParams {
  serviceSupabase: any;
  openai: any;
  discussionId: string;
  artifactId: string;
  signal?: AbortSignal;
  result: IndexDiscussionImageArtifactsResult;
}

/**
 * Handles the 5-state claim-token lifecycle for a single canonical artifact.
 */
async function processSingleArtifactIndexing(params: ProcessSingleArtifactParams): Promise<void> {
  const { serviceSupabase, openai, artifactId, signal, result } = params;

  // A. Check existing record
  const { data: existingRow, error: fetchErr } = await serviceSupabase
    .from("discussion_artifact_descriptors")
    .select("id, indexing_status, claim_token, claimed_at, descriptor_json, descriptor_text")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (fetchErr) {
    result.errors.push({ artifactId, error: fetchErr.message });
    return;
  }

  let claimToken: string | null = null;
  let currentStage: "vision_pending" | "embedding_pending" | null = null;
  let descriptorJson: VisualDescriptorJson | null = null;
  let descriptorText: string | null = null;

  const nowMs = Date.now();
  const staleThresholdIso = new Date(nowMs - STALE_LEASE_SECONDS * 1000).toISOString();

  // B. State machine claim / recovery determination
  if (!existingRow) {
    // 1. Brand new artifact: Initial claim attempt
    const initialToken = crypto.randomUUID();
    const { data: inserted, error: insertErr } = await serviceSupabase
      .from("discussion_artifact_descriptors")
      .insert({
        artifact_id: artifactId,
        indexing_status: "vision_pending",
        claim_token: initialToken,
        claimed_at: new Date().toISOString(),
        descriptor_model: "google/gemini-3.7-flash",
        descriptor_version: "v1",
      })
      .select("id, claim_token, indexing_status")
      .maybeSingle();

    if (insertErr) {
      if (insertErr.code === "23505" || insertErr.message?.includes("duplicate key")) {
        // Expected unique artifact_id race: another concurrent worker claimed it
        result.skippedCount++;
        return;
      }
      // Any other database/infrastructure error: record in result.errors, make 0 AI calls
      console.warn(`[Visual Indexer] Database error on initial claim for artifact ${artifactId}:`, insertErr);
      result.errors.push({ artifactId, error: insertErr.message || "Initial claim database error" });
      return;
    }

    if (!inserted) {
      result.skippedCount++;
      return;
    }

    claimToken = initialToken;
    currentStage = "vision_pending";
  } else {
    const status = existingRow.indexing_status;
    if (status === "completed") {
      result.skippedCount++;
      return;
    }

    const isVisionStale =
      status === "vision_pending" &&
      typeof existingRow.claimed_at === "string" &&
      !isNaN(Date.parse(existingRow.claimed_at)) &&
      Date.parse(existingRow.claimed_at) < (nowMs - STALE_LEASE_SECONDS * 1000);

    const isEmbeddingStale =
      status === "embedding_pending" &&
      typeof existingRow.claimed_at === "string" &&
      !isNaN(Date.parse(existingRow.claimed_at)) &&
      Date.parse(existingRow.claimed_at) < (nowMs - STALE_LEASE_SECONDS * 1000);

    if (status === "vision_failed" || isVisionStale) {
      // 2. Vision retry or stale lease reclaim
      const newToken = crypto.randomUUID();
      let query = serviceSupabase
        .from("discussion_artifact_descriptors")
        .update({
          indexing_status: "vision_pending",
          claim_token: newToken,
          claimed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("artifact_id", artifactId);

      if (status === "vision_failed") {
        query = query.eq("indexing_status", "vision_failed");
      } else {
        query = query.eq("indexing_status", "vision_pending").lt("claimed_at", staleThresholdIso);
      }

      const { data: reclaimed, error: reclaimErr } = await query
        .select("id, claim_token, indexing_status")
        .maybeSingle();

      if (reclaimErr || !reclaimed) {
        result.skippedCount++;
        return;
      }

      claimToken = newToken;
      currentStage = "vision_pending";
    } else if (status === "embedding_failed" || isEmbeddingStale) {
      // 3. Embedding retry or stale lease reclaim (SKIPS VISION)
      const newToken = crypto.randomUUID();
      let query = serviceSupabase
        .from("discussion_artifact_descriptors")
        .update({
          indexing_status: "embedding_pending",
          claim_token: newToken,
          claimed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("artifact_id", artifactId);

      if (status === "embedding_failed") {
        query = query.eq("indexing_status", "embedding_failed");
      } else {
        query = query.eq("indexing_status", "embedding_pending").lt("claimed_at", staleThresholdIso);
      }

      const { data: reclaimed, error: reclaimErr } = await query
        .select("id, claim_token, indexing_status, descriptor_json, descriptor_text")
        .maybeSingle();

      if (reclaimErr || !reclaimed) {
        result.skippedCount++;
        return;
      }

      claimToken = newToken;
      currentStage = "embedding_pending";
      descriptorJson = (reclaimed.descriptor_json || existingRow.descriptor_json) as VisualDescriptorJson;
      descriptorText = reclaimed.descriptor_text || existingRow.descriptor_text;
    } else {
      // Active non-stale lease held by another worker
      result.skippedCount++;
      return;
    }
  }

  if (!claimToken || !currentStage) {
    result.skippedCount++;
    return;
  }

  // C. Execute Vision Stage if needed
  if (currentStage === "vision_pending") {
    if (signal?.aborted) return;

    // 1. Resolve canonical source alias (earliest registered alias)
    const { data: sourceRows, error: srcErr } = await serviceSupabase
      .from("discussion_artifact_sources")
      .select("storage_path, filename, created_at")
      .eq("artifact_id", artifactId)
      .order("created_at", { ascending: true })
      .limit(1);

    if (srcErr || !sourceRows || sourceRows.length === 0 || !sourceRows[0]?.storage_path) {
      await markVisionFailed(serviceSupabase, artifactId, claimToken);
      result.errors.push({ artifactId, error: "Failed to resolve canonical source alias" });
      return;
    }

    const canonicalSource = sourceRows[0];

    // 2. Generate short-lived signed URL for downloading / viewing
    const { data: signedData, error: signErr } = await serviceSupabase.storage
      .from("message-images")
      .createSignedUrl(canonicalSource.storage_path, 900);

    if (signErr || !signedData?.signedUrl) {
      await markVisionFailed(serviceSupabase, artifactId, claimToken);
      result.errors.push({ artifactId, error: signErr?.message || "Failed to sign storage URL" });
      return;
    }

    // 3. Normalize image delivery (Gemini EXIF normalization for Orientation 2-8, original signed URL otherwise)
    // Retain real filename/extension without inventing .jpg for non-JPEG formats
    const fallbackFilename = canonicalSource.storage_path
      ? canonicalSource.storage_path.split("/").pop()?.replace(/^\d+-\d+-[^-]+-/, "") || "image"
      : "image";
    const effectiveFilename = canonicalSource.filename || fallbackFilename;

    let visionUrl = signedData.signedUrl;
    try {
      const prepared = await prepareGeminiVisionAttachments([
        { url: signedData.signedUrl, filename: effectiveFilename },
      ]);
      if (prepared && prepared[0]?.url) {
        visionUrl = prepared[0].url;
      }
    } catch (normErr: any) {
      console.warn("[Visual Indexer] Gemini vision EXIF normalization fallback to signed URL:", normErr);
    }

    // Token-guarded lease refresh / ownership verification immediately before paid Gemini call
    const leaseRefreshTime = new Date().toISOString();
    const { data: refreshedLease, error: refreshErr } = await serviceSupabase
      .from("discussion_artifact_descriptors")
      .update({
        claimed_at: leaseRefreshTime,
        updated_at: leaseRefreshTime,
      })
      .eq("artifact_id", artifactId)
      .eq("claim_token", claimToken)
      .eq("indexing_status", "vision_pending")
      .select("id")
      .maybeSingle();

    if (refreshErr || !refreshedLease) {
      if (refreshErr) {
        console.warn(`[Visual Indexer] Error refreshing vision lease for artifact ${artifactId}:`, refreshErr);
        result.errors.push({ artifactId, error: refreshErr.message || "Vision lease refresh error" });
      } else {
        console.warn(`[Visual Indexer] Worker lost claim ownership for artifact ${artifactId} before vision call`);
      }
      return;
    }

    // 4. Call Gemini 3.7 Flash for compact structured visual description
    const visionSystemPrompt =
      "You are a visual indexing engine. Analyze the provided image and output ONLY a valid JSON object matching the requested schema. Do not include markdown code fences, commentary, or extra text.";

    const visionUserPrompt = `Analyze this image and provide a structured JSON visual descriptor for indexing and retrieval.\nSchema:\n{\n  \"scene\": \"A concise 1-2 sentence description of the overall scene/subject (max 300 chars)\",\n  \"image_type\": \"photo\" | \"screenshot\" | \"diagram\" | \"scan\" | \"document_photo\" | \"other\",\n  \"people_count\": integer count of visible people (0 if confidently none visible, null if unclear, ambiguous, or not applicable),\n  \"objects\": [\"key visible object (max 15 items, max 50 chars each)\"],\n  \"colors\": [\"dominant color (max 8 items, max 30 chars each)\"],\n  \"visible_text\": [\"concise visible text snippet or heading/label (max 10 snippets, max 80 chars each, max 500 chars total)\"],\n  \"details\": [\"notable visual nuance or setting detail (max 6 items, max 100 chars each)\"]\n}`;

    let validated: VisualDescriptorJson | null = null;
    try {
      const response = await openai.chat.completions.create(
        {
          model: "google/gemini-3.7-flash",
          messages: [
            { role: "system", content: visionSystemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: visionUserPrompt },
                { type: "image_url", image_url: { url: visionUrl } },
              ],
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1000,
          temperature: 0.1,
        },
        { timeout: 30000, signal }
      );

      const rawContent = response?.choices?.[0]?.message?.content || "";
      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(rawContent);
      } catch {
        const jsonMatch = rawContent.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/);
        if (jsonMatch && jsonMatch[1]) {
          parsedJson = JSON.parse(jsonMatch[1]);
        }
      }

      validated = validateAndSanitizeDescriptor(parsedJson);
    } catch (apiErr: any) {
      await markVisionFailed(serviceSupabase, artifactId, claimToken);
      result.errors.push({ artifactId, error: apiErr?.message || "Vision model inference failed" });
      return;
    }

    if (!validated) {
      await markVisionFailed(serviceSupabase, artifactId, claimToken);
      result.errors.push({ artifactId, error: "Malformed or invalid visual descriptor JSON response" });
      return;
    }

    descriptorJson = validated;
    descriptorText = formatDescriptorText(validated);

    // Explicit deterministic newline-joined serialization for the separate TEXT column
    const visibleTextForDb =
      Array.isArray(descriptorJson.visible_text) && descriptorJson.visible_text.length > 0
        ? descriptorJson.visible_text.join("\n")
        : null;

    // 5. Atomic state transition: vision_pending -> embedding_pending
    const { data: transitioned, error: transErr } = await serviceSupabase
      .from("discussion_artifact_descriptors")
      .update({
        indexing_status: "embedding_pending",
        descriptor_json: descriptorJson,
        descriptor_text: descriptorText,
        visible_text: visibleTextForDb,
        image_type: descriptorJson.image_type || null,
        people_count: descriptorJson.people_count,
        claimed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("artifact_id", artifactId)
      .eq("claim_token", claimToken)
      .eq("indexing_status", "vision_pending")
      .select("id")
      .maybeSingle();

    if (transErr || !transitioned) {
      // Lost claim ownership to a stale lease reclaim during vision inference!
      console.warn(`[Visual Indexer] Worker lost claim ownership for artifact ${artifactId} during vision stage`);
      return;
    }

    currentStage = "embedding_pending";
  }

  // D. Execute Embedding Stage
  if (currentStage === "embedding_pending") {
    if (signal?.aborted) return;
    if (!descriptorText) {
      await markEmbeddingFailed(serviceSupabase, artifactId, claimToken);
      result.errors.push({ artifactId, error: "Missing descriptor text for embedding" });
      return;
    }

    let embeddingVector: number[] | null = null;
    try {
      const embRes = await (openai.embeddings.create as any)(
        {
          model: "google/gemini-embedding-2",
          dimensions: 1536,
          input: descriptorText,
          encoding_format: "float",
        },
        {
          timeout: 15000,
          signal,
        }
      );

      const vector = embRes?.data?.[0]?.embedding;
      if (Array.isArray(vector) && vector.length === 1536) {
        embeddingVector = vector;
      } else {
        throw new Error(`Embedding vector length mismatch: expected 1536, received ${vector?.length || 0}`);
      }
    } catch (embErr: any) {
      console.warn(`[Visual Indexer] Embedding failed for artifact ${artifactId}:`, embErr);
      await markEmbeddingFailed(serviceSupabase, artifactId, claimToken);
      result.errors.push({ artifactId, error: embErr?.message || "Embedding generation failed" });
      return;
    }

    // Atomic completion transition: embedding_pending -> completed (clears lease)
    const { data: completedRow, error: compErr } = await serviceSupabase
      .from("discussion_artifact_descriptors")
      .update({
        indexing_status: "completed",
        embedding: embeddingVector,
        claim_token: null,
        claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("artifact_id", artifactId)
      .eq("claim_token", claimToken)
      .eq("indexing_status", "embedding_pending")
      .select("id")
      .maybeSingle();

    if (compErr || !completedRow) {
      console.warn(`[Visual Indexer] Worker lost claim ownership for artifact ${artifactId} during embedding stage`);
      return;
    }

    result.indexedCount++;
  }
}

async function markVisionFailed(serviceSupabase: any, artifactId: string, claimToken: string): Promise<void> {
  await serviceSupabase
    .from("discussion_artifact_descriptors")
    .update({
      indexing_status: "vision_failed",
      claim_token: null,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("artifact_id", artifactId)
    .eq("claim_token", claimToken)
    .eq("indexing_status", "vision_pending");
}

async function markEmbeddingFailed(serviceSupabase: any, artifactId: string, claimToken: string): Promise<void> {
  await serviceSupabase
    .from("discussion_artifact_descriptors")
    .update({
      indexing_status: "embedding_failed",
      claim_token: null,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("artifact_id", artifactId)
    .eq("claim_token", claimToken)
    .eq("indexing_status", "embedding_pending");
}
