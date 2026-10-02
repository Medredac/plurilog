import type { Metadata } from 'next';
import { FeedbackPreviewCard } from '@/components/FeedbackPreviewCard';

export const metadata: Metadata = {
  title: 'Feedback Thanks Preview | Plurilog',
  robots: {
    index: false,
    follow: false,
  },
};

export default function FeedbackThanksPreviewPage() {
  return <FeedbackPreviewCard mode="thanks" />;
}
