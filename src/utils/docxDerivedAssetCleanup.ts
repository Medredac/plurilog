const STORAGE_BUCKET = 'message-images';

export interface CleanupUnregisteredDocxDerivedAssetsOptions {
  serviceSupabase: any;
  discussionId: string;
  storagePaths: string[];
}

export interface CleanupUnregisteredDocxDerivedAssetsResult {
  checkedCount: number;
  registeredCount: number;
  removedCount: number;
  errors: string[];
}

export function isDocxDerivedStoragePath(path?: string | null): boolean {
  if (!path || typeof path !== 'string') return false;
  return path.includes('/docx-pages/') || path.includes('/docx-assets/');
}

/**
 * Removes only DOCX-derived storage objects that still have no canonical
 * discussion_artifact_sources row after normal registration/retry work.
 *
 * This is deliberately storage-only cleanup. Registered derived assets remain
 * discoverable by the existing visual system and discussion deletion flow.
 */
export async function cleanupUnregisteredDocxDerivedAssets(
  options: CleanupUnregisteredDocxDerivedAssetsOptions
): Promise<CleanupUnregisteredDocxDerivedAssetsResult> {
  const result: CleanupUnregisteredDocxDerivedAssetsResult = {
    checkedCount: 0,
    registeredCount: 0,
    removedCount: 0,
    errors: [],
  };

  const { serviceSupabase, discussionId, storagePaths } = options;
  if (!serviceSupabase || !discussionId || !Array.isArray(storagePaths)) {
    return result;
  }

  const candidates = Array.from(
    new Set(
      storagePaths.filter(
        (path): path is string => isDocxDerivedStoragePath(path)
      )
    )
  );

  result.checkedCount = candidates.length;
  if (candidates.length === 0) return result;

  const { data: sourceRows, error: sourceError } = await serviceSupabase
    .from('discussion_artifact_sources')
    .select('storage_path')
    .eq('discussion_id', discussionId)
    .in('storage_path', candidates);

  if (sourceError) {
    result.errors.push(sourceError.message || 'Failed to verify DOCX derived asset registration');
    return result;
  }

  const registered = new Set(
    (sourceRows || [])
      .map((row: any) => row?.storage_path)
      .filter((path: unknown): path is string => typeof path === 'string')
  );
  result.registeredCount = registered.size;

  const orphaned = candidates.filter((path) => !registered.has(path));
  if (orphaned.length === 0) return result;

  const { data: removedRows, error: removeError } = await serviceSupabase.storage
    .from(STORAGE_BUCKET)
    .remove(orphaned);

  if (removeError) {
    result.errors.push(removeError.message || 'Failed to remove unregistered DOCX derived assets');
    return result;
  }

  result.removedCount = Array.isArray(removedRows)
    ? removedRows.length
    : orphaned.length;

  console.log('[DOCX Visual] Cleaned unregistered derived assets:', {
    discussionId,
    checkedCount: result.checkedCount,
    registeredCount: result.registeredCount,
    removedCount: result.removedCount,
  });

  return result;
}
