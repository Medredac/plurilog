import type { Metadata } from 'next';
import { FeedbackPreviewCard } from '@/components/FeedbackPreviewCard';

export const metadata: Metadata = {
  title: 'Feedback Preview | Plurilog',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function FeedbackPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawName = Array.isArray(params.name) ? params.name[0] : params.name;
  const firstName = String(rawName || '').trim().split(/\s+/)[0] || 'there';

  return (
    <FeedbackPreviewCard
      initialMode="form"
      initialFirstName={firstName}
    />
  );
}
