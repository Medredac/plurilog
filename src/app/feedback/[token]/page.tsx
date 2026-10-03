import type { Metadata } from 'next';
import { FeedbackPreviewCard } from '@/components/FeedbackPreviewCard';
import { resolveFeedbackRequest } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Feedback',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  try {
    const resolved = await resolveFeedbackRequest(token, { markOpened: true });

    if (!resolved) {
      return <FeedbackPreviewCard invalid />;
    }

    return (
      <FeedbackPreviewCard
        token={token}
        initialFirstName={resolved.firstName}
      />
    );
  } catch (error) {
    console.error('[Feedback Page] Failed to resolve feedback request:', error);
    return <FeedbackPreviewCard loadError />;
  }
}
