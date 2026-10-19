import { notFound, redirect } from 'next/navigation';
import { isBillingPreview } from '@/lib/paidEntry';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default function Page() {
  if (!isBillingPreview()) notFound();
  redirect('/dashboard?upgrade=true');
}
