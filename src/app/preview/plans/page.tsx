import { notFound } from 'next/navigation';
import { isBillingPreview } from '@/lib/paidEntry';
import { PlanPreview } from './PlanPreview';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ checkout?: string; manage?: string }> }) {
  if (!isBillingPreview()) notFound();
  const params = await searchParams;
  return <PlanPreview checkout={params.checkout || null} manage={params.manage === 'true'}/>;
}
