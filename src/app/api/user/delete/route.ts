import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

const STORAGE_BUCKET = 'message-images';
const STORAGE_LIST_LIMIT = 1000;
const STORAGE_REMOVE_BATCH_SIZE = 20;
const STORAGE_MAX_ATTEMPTS = 6;
const STORAGE_DELETE_PASSES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStorageError(error: any): boolean {
  if (!error) return false;

  const status = Number(error.status ?? error.statusCode);
  const code = String(error.code || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();

  return (
    status === 429 ||
    code === 'slowdown' ||
    message.includes('too many connections') ||
    message.includes('rate limit') ||
    message.includes('slow down') ||
    message.includes('slowdown')
  );
}

async function withStorageRetry(
  label: string,
  operation: () => Promise<any>
): Promise<any> {
  let lastResult: any = null;

  for (let attempt = 1; attempt <= STORAGE_MAX_ATTEMPTS; attempt += 1) {
    lastResult = await operation();

    if (!lastResult?.error) {
      return lastResult;
    }

    if (
      !isRetryableStorageError(lastResult.error) ||
      attempt === STORAGE_MAX_ATTEMPTS
    ) {
      return lastResult;
    }

    const delayMs = 250 * 2 ** (attempt - 1);
    console.warn('[Account Deletion] Retrying storage operation:', {
      label,
      attempt,
      delayMs,
      code: lastResult.error?.code || null,
      status: lastResult.error?.status ?? lastResult.error?.statusCode ?? null,
      message: lastResult.error?.message || null,
    });
    await sleep(delayMs);
  }

  return lastResult;
}

async function listUserStorageObjects(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<string[]> {
  const bucket = serviceClient.storage.from(STORAGE_BUCKET);
  const foldersToVisit = [userId];
  const visitedFolders = new Set<string>();
  const objectPaths: string[] = [];

  while (foldersToVisit.length > 0) {
    const prefix = foldersToVisit.shift()!;
    if (visitedFolders.has(prefix)) continue;
    visitedFolders.add(prefix);

    let offset = 0;

    while (true) {
      const { data: entries, error } = await withStorageRetry(
        `list:${prefix}:${offset}`,
        () =>
          bucket.list(prefix, {
            limit: STORAGE_LIST_LIMIT,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          })
      );

      if (error) {
        throw error;
      }

      const page = Array.isArray(entries) ? entries : [];

      for (const entry of page) {
        if (!entry?.name || entry.name === '.emptyFolderPlaceholder') {
          continue;
        }

        const path = `${prefix}/${entry.name}`;

        // Supabase Storage list() returns folder entries with id === null.
        if (entry.id === null) {
          if (!visitedFolders.has(path)) {
            foldersToVisit.push(path);
          }
        } else {
          objectPaths.push(path);
        }
      }

      if (page.length < STORAGE_LIST_LIMIT) {
        break;
      }

      offset += page.length;
    }
  }

  return Array.from(new Set(objectPaths));
}

async function removeUserStorageObjects(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string
) {
  const bucket = serviceClient.storage.from(STORAGE_BUCKET);
  let totalRemoved = 0;

  // Multiple passes protect against a file being created between enumeration
  // and deletion by a request that was already in flight when deletion began.
  for (let pass = 1; pass <= STORAGE_DELETE_PASSES; pass += 1) {
    const paths = await listUserStorageObjects(serviceClient, userId);

    if (paths.length === 0) {
      console.log('[Account Deletion] Storage cleanup complete:', {
        bucket: STORAGE_BUCKET,
        totalRemoved,
        pass,
      });
      return;
    }

    console.log('[Account Deletion] Storage cleanup pass:', {
      bucket: STORAGE_BUCKET,
      pass,
      objectCount: paths.length,
    });

    for (let index = 0; index < paths.length; index += STORAGE_REMOVE_BATCH_SIZE) {
      const batch = paths.slice(index, index + STORAGE_REMOVE_BATCH_SIZE);
      const { error } = await withStorageRetry(
        `remove:${pass}:${index}`,
        () => bucket.remove(batch)
      );

      if (error) {
        throw error;
      }

      totalRemoved += batch.length;

      // Avoid hammering Storage/Postgres with consecutive bulk deletes.
      if (index + STORAGE_REMOVE_BATCH_SIZE < paths.length) {
        await sleep(100);
      }
    }
  }

  const remainingPaths = await listUserStorageObjects(serviceClient, userId);
  if (remainingPaths.length > 0) {
    throw new Error(
      `Storage cleanup verification failed: ${remainingPaths.length} object(s) remain`
    );
  }

  console.log('[Account Deletion] Storage cleanup complete:', {
    bucket: STORAGE_BUCKET,
    totalRemoved,
    pass: STORAGE_DELETE_PASSES,
  });
}

export async function POST(request: Request) {
  try {
    // 1. Authenticate current user using server Supabase client
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'unauthorized', message: 'Not authenticated' }, { status: 401 });
    }

    // Parse optional confirmation flag
    let confirmCanceling = false;
    try {
      const body = await request.json();
      confirmCanceling = Boolean(body?.confirmCanceling);
    } catch {
      // Body is optional on initial request
    }

    // 2. Read the current profile using service client
    const serviceClient = createServiceClient();
    const { data: profile, error: profileErr } = await serviceClient
      .from('profiles')
      .select('id, plan, plan_status, current_period_end')
      .eq('id', user.id)
      .maybeSingle();

    if (profileErr) {
      console.error('[Account Deletion] Failed to fetch profile:', profileErr);
      return NextResponse.json({ error: 'database_error', message: 'Failed to verify account status.' }, { status: 500 });
    }

    // 3. Evaluate subscription safety
    if (profile?.plan === 'paid') {
      if (profile.plan_status === 'canceling') {
        if (!confirmCanceling) {
          return NextResponse.json({
            code: 'canceling_subscription_confirmation_required',
            currentPeriodEnd: profile.current_period_end || null,
          });
        }
        // If confirmCanceling is true, deletion proceeds below
      } else if (profile.plan_status === 'canceled') {
        // Former paid user with ended subscription: deletion proceeds
      } else {
        // active, past_due, or any other paid status -> block deletion
        return NextResponse.json({
          code: 'active_subscription_must_be_canceled',
        });
      }
    }

    // 4. Permanently remove every Storage object under this user's prefix.
    // This includes nested uploads, generated files/images, rendered document
    // pages, visual assets, and preview artifacts.
    try {
      await removeUserStorageObjects(serviceClient, user.id);
    } catch (storageError: any) {
      console.error('[Account Deletion] Storage cleanup failed:', storageError);
      return NextResponse.json(
        {
          error: 'storage_cleanup_failed',
          message: 'Failed to remove uploaded files. Account deletion halted.',
        },
        { status: 500 }
      );
    }

    // 5. Delete the Auth user. The database foreign keys are ON DELETE CASCADE:
    // auth user -> profile/discussions/spend events -> messages, memory,
    // document/artifact metadata, visual evidence, and discussion context.
    const { error: deleteUserErr } = await serviceClient.auth.admin.deleteUser(user.id);
    if (deleteUserErr) {
      console.error('[Account Deletion] Auth admin deleteUser failed:', deleteUserErr);
      return NextResponse.json(
        { error: 'auth_deletion_failed', message: 'Failed to delete account credentials.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Account Deletion] Unexpected error:', err);
    return NextResponse.json(
      { error: 'server_error', message: 'An unexpected error occurred during account deletion.' },
      { status: 500 }
    );
  }
}
