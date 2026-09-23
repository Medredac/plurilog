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
  generationKind: 'create' | 'revision' | 'convert';
}

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
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
  return JSON.stringify(value);
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
    generation_kind: generationKind,
  };

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
        byte_size: Buffer.byteLength(JSON.stringify(metadata), 'utf8'),
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
    generationKind:
      meta.generation_kind === 'revision' ||
      meta.generation_kind === 'convert'
        ? meta.generation_kind
        : 'create',
  };
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

  const normalizedFilename = (filename || '').trim().toLowerCase();
  for (const row of data) {
    const snapshot = snapshotFromRow(discussionId, row);
    if (!snapshot) continue;

    if (storagePath && snapshot.storagePath === storagePath) return snapshot;
    if (documentId && snapshot.documentId === documentId) return snapshot;
    if (
      normalizedFilename &&
      snapshot.filename.trim().toLowerCase() === normalizedFilename
    ) {
      return snapshot;
    }
  }

  return null;
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
        throw new Error(`Revision patch path does not exist: ${operation.path}`);
      }
      parent[leaf] = jsonClone(operation.value);
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

export function missingPreservedDocumentContent(
  parentSpec: Record<string, any>,
  nextSpec: Record<string, any>
): string[] {
  const parentValues = [
    typeof parentSpec.title === 'string' ? parentSpec.title : '',
    ...(Array.isArray(parentSpec.blocks)
      ? parentSpec.blocks.flatMap(semanticStringsFromBlock)
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

  const next = jsonClone(spec);
  next.design = {
    ...(next.design || {}),
    targetPageCount: parentPageCount,
  };
  return next;
}

export function userExplicitlyAllowsContentRemoval(prompt: string): boolean {
  return /\b(?:delete|remove|omit|drop|cut|shorten|summari[sz]e|condense|trim|strip)\b/i.test(
    prompt || ''
  );
}
