import type { Metadata } from 'next';
import { FeedbackPreviewCard } from '@/components/FeedbackPreviewCard';

export const metadata: Metadata = {
  title: 'Feedback Preview | Plurilog',
  robots: {
    index: false,
    follow: false,
  },
};

export default function FeedbackPreviewPage() {
  return <FeedbackPreviewCard mode="form" />;
}
