import { NextResponse } from 'next/server';

/**
 * Image / File Cleanup Route — PERMANENTLY DISABLED
 *
 * Age-based deletion of user attachments has been removed.
 * User-uploaded files (PDFs, images) are permanently preserved in Supabase Storage
 * for the lifetime of their parent discussion.
 *
 * Explicit deletion of attachments occurs exclusively when a user deletes a discussion.
 */
export async function GET() {
  return NextResponse.json({
    status: 'disabled',
    message:
      'Age-based attachment cleanup is permanently disabled. User attachments are preserved for active discussions.',
  });
}

export async function POST() {
  return NextResponse.json({
    status: 'disabled',
    message:
      'Age-based attachment cleanup is permanently disabled. User attachments are preserved for active discussions.',
  });
}
