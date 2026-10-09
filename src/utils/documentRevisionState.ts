import crypto from 'node:crypto';

const DOCUMENT_STATE_ARTIFACT_TYPE = 'document_state';

export interface DocumentStateImageSource {
  filename: string;
  storagePath?: string | null;
  artifactId?: string | null;
  sourceMessageId?: string | null;
  attachmentIndex?: number | null;
  createdAt?: string | null;
  sender?: string | null;
}

export interface DocumentStateImageBinding {
  imageOrdinal: number;
  source: DocumentStateImageSource;
}

export interface DocumentStateSnapshot {
  id: string;
  createdAt?: string | null;
  discussionId: string;
  documentId?: string | null;
  filename: string;
  storagePath: string;
  messageId?: string | null;
  format: 'docx' | 'pdf';
  spec: Record<string, any>;
  fullText: string;
  pageCount?: number | null;
  parentSnapshotId?: string | null;
  parentDocumentId?: string | null;
  parentStoragePath?: string | null;
  sourceDocumentIds: string[];
  imageSources: DocumentStateImageSource[];
  imageBindings: DocumentStateImageBinding[];
  generationKind: 'create' | 'revision' | 'convert';
}

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

function jsonClone<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return value;
  }
  return JSON.parse(serialized) as T;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function stripRuntimePayloads(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRuntimePayloads);
  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === 'imageData' ||
      key === 'imageContentType' ||
      key === 'imageAltText'
    ) {
      continue;
    }
    result[key] = stripRuntimePayloads(child);
  }
  return result;
}

export function sanitizeDocumentSpecForState<T extends Record<string, any>>(
  spec: T
): T {
  return stripRuntimePayloads(jsonClone(spec)) as T;
}

export async function persistDocumentStateSnapshot(options: {
  serviceSupabase: any;
  discussionId: string;
  documentId?: string | null;
  filename: string;
  storagePath: string;
  messageId?: string | null;
  format: 'docx' | 'pdf';
  spec: Record<string, any>;
  fullText: string;
  pageCount?: number | null;
  parentSnapshotId?: string | null;
  parentDocumentId?: string | null;
  parentStoragePath?: string | null;
  sourceDocumentIds?: string[];
  imageSources?: DocumentStateImageSource[];
  imageBindings?: DocumentStateImageBinding[];
  generationKind?: 'create' | 'revision' | 'convert';
}): Promise<DocumentStateSnapshot | null> {
  const {
    serviceSupabase,
    discussionId,
    documentId = null,
    filename,
    storagePath,
    messageId = null,
    format,
    spec,
    fullText,
    pageCount = null,
    parentSnapshotId = null,
    parentDocumentId = null,
    parentStoragePath = null,
    sourceDocumentIds = [],
    imageSources = [],
    imageBindings = [],
    generationKind = 'create',
  } = options;

  if (!serviceSupabase || !discussionId || !filename || !storagePath) {
    return null;
  }

  const safeSpec = sanitizeDocumentSpecForState(spec);
  const safeImages = imageSources.slice(0, 32).map((source) => ({
    filename: source.filename,
    storagePath: source.storagePath || null,
    artifactId: source.artifactId || null,
    sourceMessageId: source.sourceMessageId || null,
    attachmentIndex:
      typeof source.attachmentIndex === 'number'
        ? source.attachmentIndex
        : null,
    createdAt: source.createdAt || null,
    sender: source.sender || null,
  }));

  const safeImageBindings = imageBindings.slice(0, 32).map((binding) => ({
    imageOrdinal: Math.max(0, Math.floor(binding.imageOrdinal || 0)),
    source: {
      filename: binding.source.filename,
      storagePath: binding.source.storagePath || null,
      artifactId: binding.source.artifactId || null,
      sourceMessageId: binding.source.sourceMessageId || null,
      attachmentIndex:
        typeof binding.source.attachmentIndex === 'number'
          ? binding.source.attachmentIndex
          : null,
      createdAt: binding.source.createdAt || null,
      sender: binding.source.sender || null,
    },
  }));

  const metadata = {
    state_version: 1,
    document_id: documentId,
    filename,
    storage_path: storagePath,
    message_id: messageId,
    format,
    spec: safeSpec,
    full_text: fullText || '',
    page_count: pageCount,
    parent_snapshot_id: parentSnapshotId,
    parent_document_id: parentDocumentId,
    parent_storage_path: parentStoragePath,
    source_document_ids: Array.from(new Set(sourceDocumentIds.filter(Boolean))),
    image_sources: safeImages,
    image_bindings: safeImageBindings,
    generation_kind: generationKind,
  };

  const serializedMetadata = JSON.stringify(metadata) ?? '{}';

  const fileHash = crypto
    .createHash('sha256')
    .update(
      `document-state-v1|${discussionId}|${storagePath}|${canonicalJson(
        safeSpec
      )}`
    )
    .digest('hex');

  const { data, error } = await serviceSupabase
    .from('discussion_artifacts')
    .upsert(
      {
        discussion_id: discussionId,
        artifact_type: DOCUMENT_STATE_ARTIFACT_TYPE,
        file_hash: fileHash,
        byte_size: Buffer.byteLength(serializedMetadata, 'utf8'),
        metadata,
      },
      { onConflict: 'discussion_id,file_hash' }
    )
    .select('id, created_at, metadata')
    .single();

  if (error || !data) {
    console.warn('[Document State] Failed to persist snapshot', {
      discussionId,
      filename,
      error: error?.message || 'missing row',
    });
    return null;
  }

  console.log('[Document State] Persisted snapshot', {
    discussionId,
    snapshotId: data.id,
    documentId,
    filename,
    parentSnapshotId,
    generationKind,
  });

  return snapshotFromRow(discussionId, data);
}

function snapshotFromRow(
  discussionId: string,
  row: { id: string; created_at?: string | null; metadata?: any }
): DocumentStateSnapshot | null {
  const meta = row?.metadata;
  if (!meta || meta.state_version !== 1 || !meta.storage_path || !meta.filename) {
    return null;
  }

  return {
    id: row.id,
    createdAt: row.created_at || null,
    discussionId,
    documentId: meta.document_id || null,
    filename: meta.filename,
    storagePath: meta.storage_path,
    messageId: meta.message_id || null,
    format: meta.format === 'docx' ? 'docx' : 'pdf',
    spec:
      meta.spec && typeof meta.spec === 'object' && !Array.isArray(meta.spec)
        ? meta.spec
        : {},
    fullText: typeof meta.full_text === 'string' ? meta.full_text : '',
    pageCount:
      typeof meta.page_count === 'number' ? meta.page_count : null,
    parentSnapshotId: meta.parent_snapshot_id || null,
    parentDocumentId: meta.parent_document_id || null,
    parentStoragePath: meta.parent_storage_path || null,
    sourceDocumentIds: Array.isArray(meta.source_document_ids)
      ? meta.source_document_ids.filter(
          (value: unknown): value is string => typeof value === 'string'
        )
      : [],
    imageSources: Array.isArray(meta.image_sources)
      ? meta.image_sources
      : [],
    imageBindings: Array.isArray(meta.image_bindings)
      ? meta.image_bindings
      : [],
    generationKind:
      meta.generation_kind === 'revision' ||
      meta.generation_kind === 'convert'
        ? meta.generation_kind
        : 'create',
  };
}

export function inferDocumentStateImageBindings(
  snapshot: DocumentStateSnapshot
): DocumentStateImageBinding[] {
  if (snapshot.imageBindings.length > 0) {
    return snapshot.imageBindings;
  }

  const imageBlocks = Array.isArray(snapshot.spec?.blocks)
    ? snapshot.spec.blocks.filter((block: any) => block?.type === 'image')
    : [];
  if (imageBlocks.length === 0 || snapshot.imageSources.length === 0) {
    return [];
  }

  const byCanonicalIdentity = new Map<string, DocumentStateImageSource>();
  for (const source of snapshot.imageSources) {
    const key =
      source.artifactId ||
      source.storagePath ||
      source.filename;
    const existing = byCanonicalIdentity.get(key);
    if (!existing) {
      byCanonicalIdentity.set(key, source);
      continue;
    }
    const existingUser = (existing.sender || '').toLowerCase() === 'user';
    const sourceUser = (source.sender || '').toLowerCase() === 'user';
    if (sourceUser && !existingUser) {
      byCanonicalIdentity.set(key, source);
    }
  }

  const uniqueSources = Array.from(byCanonicalIdentity.values());
  if (uniqueSources.length === 1 && imageBlocks.length === 1) {
    return [{ imageOrdinal: 0, source: uniqueSources[0] }];
  }

  return [];
}

export async function listDocumentStateSnapshots(options: {
  serviceSupabase: any;
  discussionId: string;
}): Promise<DocumentStateSnapshot[]> {
  const { serviceSupabase, discussionId } = options;
  if (!serviceSupabase || !discussionId) return [];

  const { data, error } = await serviceSupabase
    .from('discussion_artifacts')
    .select('id, created_at, metadata')
    .eq('discussion_id', discussionId)
    .eq('artifact_type', DOCUMENT_STATE_ARTIFACT_TYPE)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error || !Array.isArray(data)) {
    if (error) {
      console.warn('[Document State] Snapshot chronology lookup failed', {
        discussionId,
        error: error.message,
      });
    }
    return [];
  }

  return data
    .map((row: any) => snapshotFromRow(discussionId, row))
    .filter(
      (snapshot: DocumentStateSnapshot | null): snapshot is DocumentStateSnapshot =>
        Boolean(snapshot)
    );
}

export function selectGeneratedDocumentStateByReference(
  snapshots: DocumentStateSnapshot[],
  userPrompt: string
): DocumentStateSnapshot | null {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  const prompt = (userPrompt || '').trim();
  const lower = prompt.toLowerCase();

  // Only resolve this path when the user explicitly refers to something the
  // panel generated/created. Uploaded-source references belong to the upload
  // provenance resolver, not the canonical generated-document chain.
  const explicitlyGenerated =
    /\b(?:generated|created|made|produced)\b/i.test(prompt) ||
    /(?:生成|作成)した/.test(prompt);
  if (!explicitlyGenerated) return null;

  let candidates = [...snapshots];

  if (/\bpdf\b/i.test(prompt)) {
    candidates = candidates.filter((snapshot) => snapshot.format === 'pdf');
  } else if (/\b(?:docx|word)\b/i.test(prompt)) {
    candidates = candidates.filter((snapshot) => snapshot.format === 'docx');
  }

  const wantsJapanese =
    /\bjapanese\b/i.test(prompt) ||
    /\brirekisho\b/i.test(prompt) ||
    /履歴書/.test(prompt);
  if (wantsJapanese) {
    candidates = candidates.filter((snapshot) => {
      const locale = String(snapshot.spec?.design?.locale || '').toLowerCase();
      const identity = [
        snapshot.filename,
        snapshot.fullText.slice(0, 400),
        snapshot.spec?.title || '',
      ]
        .join(' ')
        .toLowerCase();
      return (
        locale.startsWith('ja') ||
        identity.includes('履歴書') ||
        identity.includes('rirekisho')
      );
    });
  }

  if (candidates.length === 0) return null;

  if (/\b(?:first|earliest|1st)\b/i.test(lower)) {
    return candidates[0] || null;
  }
  if (/\b(?:second|2nd)\b/i.test(lower)) {
    return candidates[1] || null;
  }
  if (/\b(?:third|3rd)\b/i.test(lower)) {
    return candidates[2] || null;
  }
  if (/\b(?:fourth|4th)\b/i.test(lower)) {
    return candidates[3] || null;
  }
  if (/\b(?:last|latest|newest|most recent)\b/i.test(lower)) {
    return candidates[candidates.length - 1] || null;
  }

  return null;
}

export async function findLatestDocumentStateSnapshot(options: {
  serviceSupabase: any;
  discussionId: string;
}): Promise<DocumentStateSnapshot | null> {
  const { serviceSupabase, discussionId } = options;
  if (!serviceSupabase || !discussionId) return null;

  const { data, error } = await serviceSupabase
    .from('discussion_artifacts')
    .select('id, created_at, metadata')
    .eq('discussion_id', discussionId)
    .eq('artifact_type', DOCUMENT_STATE_ARTIFACT_TYPE)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn('[Document State] Latest snapshot lookup failed', {
        discussionId,
        error: error.message,
      });
    }
    return null;
  }

  return snapshotFromRow(discussionId, data);
}

export async function findDocumentStateSnapshot(options: {
  serviceSupabase: any;
  discussionId: string;
  storagePath?: string | null;
  filename?: string | null;
  documentId?: string | null;
}): Promise<DocumentStateSnapshot | null> {
  const {
    serviceSupabase,
    discussionId,
    storagePath = null,
    filename = null,
    documentId = null,
  } = options;

  if (!serviceSupabase || !discussionId) return null;

  const { data, error } = await serviceSupabase
    .from('discussion_artifacts')
    .select('id, created_at, metadata')
    .eq('discussion_id', discussionId)
    .eq('artifact_type', DOCUMENT_STATE_ARTIFACT_TYPE)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !Array.isArray(data)) {
    if (error) {
      console.warn('[Document State] Snapshot lookup failed', {
        discussionId,
        error: error.message,
      });
    }
    return null;
  }

  const snapshots = data
    .map((row: any) => snapshotFromRow(discussionId, row))
    .filter(
      (snapshot: DocumentStateSnapshot | null): snapshot is DocumentStateSnapshot =>
        Boolean(snapshot)
    );

  // Exact provenance always outranks filename similarity. If the caller
  // supplied a storage path or document ID, never silently fall through to a
  // newer generated descendant that happens to share the same filename.
  if (storagePath || documentId) {
    const exact = snapshots.find(
      (snapshot) =>
        (storagePath && snapshot.storagePath === storagePath) ||
        (documentId && snapshot.documentId === documentId)
    );
    return exact || null;
  }

  const normalizedFilename = (filename || '').trim().toLowerCase();
  if (!normalizedFilename) return null;

  return (
    snapshots.find(
      (snapshot) =>
        snapshot.filename.trim().toLowerCase() === normalizedFilename
    ) || null
  );
}

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pathTokens(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) {
    throw new Error(`Revision patch path must be a JSON pointer: ${path}`);
  }
  return path
    .slice(1)
    .split('/')
    .map(decodePointerToken);
}

function assertSafeToken(token: string): void {
  if (
    token === '__proto__' ||
    token === 'prototype' ||
    token === 'constructor'
  ) {
    throw new Error('Unsafe revision patch path.');
  }
}

export function assertNarrowRevisionPatchSafety(
  operations: JsonPatchOperation[],
  userPrompt: string
): void {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('A narrow document revision requires at least one patch operation.');
  }
  const allowsRemoval = userExplicitlyAllowsContentRemoval(userPrompt);
  for (const operation of operations) {
    const path = operation.path || '';

    if (
      operation.op === 'replace' &&
      (
        path === '/blocks' ||
        path === '/design' ||
        /^\/blocks\/\d+$/.test(path)
      )
    ) {
      throw new Error(
        `Narrow revisions cannot replace an entire document structure or content block: ${path}`
      );
    }

    if (operation.op === 'remove' && !allowsRemoval) {
      throw new Error(
        `The user did not ask to remove document content, so remove is not allowed for this revision: ${path}`
      );
    }
  }
}

export function normalizeRevisionCompositions<T extends Record<string, any>>(
  spec: T,
  userPrompt: string
): T {
  const prompt = userPrompt || '';
  const wantsPhoto =
    /\b(?:photo|portrait|headshot|picture|image)\b/i.test(prompt) ||
    /(?:写真|証明写真|顔写真|ポートレート)/.test(prompt);
  if (!wantsPhoto || !Array.isArray((spec as any).blocks)) return spec;

  const next: any = jsonClone(spec);
  const blocks: any[] = next.blocks;
  const tableIndex = blocks.findIndex(
    (block) =>
      block?.type === 'table' &&
      Array.isArray(block.headers) &&
      block.headers.some((value: unknown) =>
        /(?:写真|photo)/i.test(String(value || ''))
      )
  );
  if (tableIndex < 0) return spec;

  const imageIndex = blocks.findIndex((block) => {
    if (block?.type !== 'image') return false;
    const descriptor = [
      block.need,
      block.prompt,
      block.caption,
      block.filename,
      block.imageAltText,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      /\b(?:photo|portrait|headshot|picture|image)\b/i.test(descriptor) ||
      /(?:写真|証明写真|顔写真|ポートレート)/.test(descriptor)
    );
  });
  if (imageIndex < 0) return spec;

  const [imageBlock] = blocks.splice(imageIndex, 1);
  const adjustedTableIndex = imageIndex < tableIndex ? tableIndex - 1 : tableIndex;
  blocks.splice(adjustedTableIndex + 1, 0, {
    ...imageBlock,
    placement: 'top-right',
    alignment: 'right',
    size: 'small',
    widthMm: 30,
    heightMm: 40,
    caption: undefined,
  });

  return next as T;
}

export function applyDocumentJsonPatch<T extends Record<string, any>>(
  baseSpec: T,
  operations: JsonPatchOperation[]
): T {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('A document revision requires at least one patch operation.');
  }
  if (operations.length > 64) {
    throw new Error('A document revision may contain at most 64 patch operations.');
  }

  const root: any = jsonClone(baseSpec);

  for (const operation of operations) {
    if (
      !operation ||
      !['add', 'remove', 'replace'].includes(operation.op) ||
      typeof operation.path !== 'string'
    ) {
      throw new Error('Invalid document revision patch operation.');
    }

    const tokens = pathTokens(operation.path);
    if (tokens.length === 0) {
      throw new Error('Replacing the entire document state is not allowed.');
    }
    for (const token of tokens) assertSafeToken(token);

    let parent: any = root;
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const token = tokens[i];
      if (Array.isArray(parent)) {
        const index = Number(token);
        if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
          throw new Error(`Revision patch array index is invalid: ${operation.path}`);
        }
        parent = parent[index];
      } else {
        if (!parent || typeof parent !== 'object' || !(token in parent)) {
          throw new Error(`Revision patch path does not exist: ${operation.path}`);
        }
        parent = parent[token];
      }
    }

    const leaf = tokens[tokens.length - 1];
    if (Array.isArray(parent)) {
      if (operation.op === 'add' && leaf === '-') {
        parent.push(jsonClone(operation.value));
        continue;
      }
      const index = Number(leaf);
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`Revision patch array index is invalid: ${operation.path}`);
      }
      if (operation.op === 'add') {
        if (index > parent.length) {
          throw new Error(`Revision patch array index is out of range: ${operation.path}`);
        }
        parent.splice(index, 0, jsonClone(operation.value));
      } else if (operation.op === 'replace') {
        if (index >= parent.length) {
          throw new Error(`Revision patch path does not exist: ${operation.path}`);
        }
        parent[index] = jsonClone(operation.value);
      } else {
        if (index >= parent.length) {
          throw new Error(`Revision patch path does not exist: ${operation.path}`);
        }
        parent.splice(index, 1);
      }
      continue;
    }

    if (!parent || typeof parent !== 'object') {
      throw new Error(`Revision patch parent is invalid: ${operation.path}`);
    }

    if (operation.op === 'remove') {
      if (!(leaf in parent)) {
        throw new Error(`Revision patch path does not exist: ${operation.path}`);
      }
      delete parent[leaf];
    } else if (operation.op === 'replace') {
      if (!(leaf in parent)) {
        // Models commonly use "replace" when semantically setting an optional
        // object property that is absent from the canonical snapshot. RFC 6902
        // would reject that spelling, but treating a missing OBJECT LEAF as an
        // add is safe and preserves the intended narrow revision. Missing
        // parents and array indices remain strict above.
        console.log('[Document Revision] Normalized replace-on-missing leaf to add', {
          path: operation.path,
        });
        parent[leaf] = jsonClone(operation.value);
      } else {
        parent[leaf] = jsonClone(operation.value);
      }
    } else {
      parent[leaf] = jsonClone(operation.value);
    }
  }

  if (!root || typeof root !== 'object') {
    throw new Error('Revision patch produced an invalid document state.');
  }
  if (root.format !== 'pdf' && root.format !== 'docx') {
    throw new Error('Revision patch must preserve a valid document format.');
  }
  if (!Array.isArray(root.blocks) || root.blocks.length === 0) {
    throw new Error('Revision patch must preserve document blocks.');
  }
  if (typeof root.filename !== 'string' || !root.filename.trim()) {
    throw new Error('Revision patch must preserve a filename.');
  }

  return root as T;
}

function normalizeSemantic(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[〜～]/g, '~')
    .toLowerCase();
}

function isNonContentScaffold(value: string): boolean {
  const compact = normalizeSemantic(value);
  return (
    !compact ||
    /^(?:写真|写真貼付欄.*)$/.test(compact) ||
    /^時間(?:[・･／/]?)分$/.test(compact) ||
    /^(?:有[・･／/]無|無[・･／/]有)$/.test(compact) ||
    /^(?:男[・･／/]女|女[・･／/]男)$/.test(compact) ||
    /^年(?:[・･／/]?)月(?:[・･／/]?)日(?:生)?(?:\(?満?歳\)?)?$/.test(compact)
  );
}

function semanticStringsFromBlock(block: any): string[] {
  if (!block || typeof block !== 'object') return [];
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return typeof block.text === 'string' ? [block.text] : [];
    case 'bullets':
    case 'numbered':
      return Array.isArray(block.items) ? block.items.map(String) : [];
    case 'table':
      return [
        ...(Array.isArray(block.headers) ? block.headers : []),
        ...(Array.isArray(block.rows) ? block.rows.flat() : []),
      ].map(String);
    case 'banner':
      return [block.eyebrow, block.title, block.subtitle]
        .filter((value) => typeof value === 'string')
        .map(String);
    case 'callout':
      return [
        block.eyebrow,
        block.title,
        block.text,
        ...(Array.isArray(block.items) ? block.items : []),
      ]
        .filter((value) => typeof value === 'string')
        .map(String);
    case 'cards':
      return (Array.isArray(block.cards) ? block.cards : []).flatMap(
        (card: any) => [card?.eyebrow, card?.title, card?.text]
      ).filter((value: unknown) => typeof value === 'string') as string[];
    case 'columns':
      return (Array.isArray(block.columns) ? block.columns : []).flatMap(
        (column: any) => [
          column?.eyebrow,
          column?.title,
          column?.text,
          ...(Array.isArray(column?.items) ? column.items : []),
        ]
      ).filter((value: unknown) => typeof value === 'string') as string[];
    case 'flow':
      return (Array.isArray(block.steps) ? block.steps : []).flatMap(
        (step: any) => [step?.label, step?.title, step?.text]
      ).filter((value: unknown) => typeof value === 'string') as string[];
    default:
      return [];
  }
}

function isRequestedTitleReplacement(oldTitle: string, newTitle: string, userPrompt: string): boolean {
  return /\b(?:change|rename|replace|update|set|retitle)\b[\s\S]{0,100}\btitle\b|\btitle\b[\s\S]{0,60}\b(?:to|as)\b/i.test(userPrompt) &&
    !/\b(?:do not|don't|never)\s+(?:change|rename|replace|update)\b[^.!?\n]{0,40}\btitle\b/i.test(userPrompt) &&
    Boolean(oldTitle.trim() && newTitle.trim()) &&
    normalizeSemantic(userPrompt).includes(normalizeSemantic(newTitle)) &&
    normalizeSemantic(oldTitle) !== normalizeSemantic(newTitle);
}

export function normalizeRequestedTitleRevision<T extends Record<string, any>>(
  parentSpec: Record<string, any>, nextSpec: T, userPrompt: string
): T {
  const oldTitle = typeof parentSpec.title === 'string' ? parentSpec.title : '';
  if (!oldTitle || !Array.isArray(parentSpec.blocks) || !Array.isArray(nextSpec.blocks)) return nextSpec;
  const matchingHeadings = parentSpec.blocks.flatMap((block: any, index: number) =>
    block?.type === 'heading' && normalizeSemantic(block.text) === normalizeSemantic(oldTitle)
      ? [index] : []);
  const candidates = [nextSpec.title, ...matchingHeadings.map((index: number) =>
    nextSpec.blocks[index]?.type === 'heading' ? nextSpec.blocks[index].text : '')]
    .filter((value): value is string => typeof value === 'string' &&
      isRequestedTitleReplacement(oldTitle, value, userPrompt));
  if (!candidates.length) return nextSpec;
  const newTitle = candidates[0];
  if (candidates.some((value) => normalizeSemantic(value) !== normalizeSemantic(newTitle))) {
    throw new Error('Revision proposes conflicting document titles.');
  }
  const next = jsonClone(nextSpec) as T & { title: string };
  // Renderers suppress a duplicate heading only when it matches the stored
  // title. Synchronize both representations even if the model patches just one.
  next.title = newTitle;
  for (const index of matchingHeadings) {
    const block = next.blocks[index];
    if (block?.type === 'heading' &&
        normalizeSemantic(block.text) === normalizeSemantic(oldTitle)) block.text = newTitle;
  }
  return next;
}

export function missingPreservedDocumentContent(
  parentSpec: Record<string, any>,
  nextSpec: Record<string, any>,
  userPrompt = ''
): string[] {
  // A requested rename may replace the document title and its matching visible
  // heading. Other headings, paragraphs and table cells remain protected, even
  // when they happen to contain the same words as the old title.
  const oldTitle = typeof parentSpec.title === 'string' ? parentSpec.title : '';
  const newTitle = typeof nextSpec.title === 'string' ? nextSpec.title : '';
  const renamesTitle = isRequestedTitleReplacement(oldTitle, newTitle, userPrompt);
  const parentValues = [
    renamesTitle ? '' : oldTitle,
    ...(Array.isArray(parentSpec.blocks)
      ? parentSpec.blocks.flatMap((block: any, index: number) => {
          const nextBlock = nextSpec.blocks?.[index];
          if (
            renamesTitle && block?.type === 'heading' &&
            normalizeSemantic(block.text) === normalizeSemantic(oldTitle) &&
            nextBlock?.type === 'heading' &&
            normalizeSemantic(nextBlock.text) === normalizeSemantic(newTitle)
          ) return [];
          return semanticStringsFromBlock(block);
        })
      : []),
  ]
    .map((value) => String(value || '').trim())
    .filter((value) => value.length >= 2 && !isNonContentScaffold(value));

  const nextHaystack = normalizeSemantic(
    [
      typeof nextSpec.title === 'string' ? nextSpec.title : '',
      ...(Array.isArray(nextSpec.blocks)
        ? nextSpec.blocks.flatMap(semanticStringsFromBlock)
        : []),
    ].join('\n')
  );

  const missing: string[] = [];
  for (const value of parentValues) {
    const needle = normalizeSemantic(value);
    if (needle.length < 2) continue;
    if (!nextHaystack.includes(needle)) {
      missing.push(value.slice(0, 240));
      if (missing.length >= 20) break;
    }
  }
  return missing;
}

export function preserveRevisionPageConstraint<T extends Record<string, any>>(
  spec: T,
  parentPageCount: number | null | undefined,
  userPrompt: string
): T {
  if (!parentPageCount || parentPageCount < 1) return spec;
  if (
    /\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?pages?\b/i.test(
      userPrompt || ''
    )
  ) {
    return spec;
  }

  const next = jsonClone(spec) as T & {
    design?: Record<string, unknown>;
  };
  next.design = {
    ...(next.design || {}),
    targetPageCount: parentPageCount,
  };
  return next as T;
}

export function userExplicitlyAllowsContentRemoval(prompt: string): boolean {
  return /\b(?:delete|remove|omit|drop|cut|shorten|summari[sz]e|condense|trim|strip)\b/i.test(
    prompt || ''
  );
}
