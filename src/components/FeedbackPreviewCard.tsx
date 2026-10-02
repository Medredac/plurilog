import Link from 'next/link';
import { PlurilogMark } from '@/components/PlurilogMark';

type FeedbackPreviewCardProps = {
  mode?: 'form' | 'thanks';
};

export function FeedbackPreviewCard({ mode = 'form' }: FeedbackPreviewCardProps) {
  return (
    <main className="min-h-screen bg-[#fafafa] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-2xl items-center justify-center sm:min-h-[calc(100vh-6rem)]">
        <section className="w-full overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white shadow-[0_24px_80px_rgba(24,24,27,0.08)]">
          <div className="h-1 w-full bg-gradient-to-r from-[#f4e4b3] via-[#ead9ae] to-[#f7edcf]" />

          <div className="px-6 py-7 sm:px-10 sm:py-10">
            <div className="mb-8 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-sm">
                <PlurilogMark className="h-5 w-5 text-zinc-900" />
              </div>
              <span className="text-sm font-semibold tracking-[-0.02em] text-zinc-900">
                Plurilog
              </span>
            </div>

            {mode === 'form' ? (
              <>
                <div className="max-w-xl">
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                    Feedback
                  </p>
                  <h1 className="text-2xl font-semibold tracking-[-0.035em] text-zinc-950 sm:text-3xl">
                    Share your feedback
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-zinc-500 sm:text-[15px]">
                    Tell us what worked, what didn&apos;t, or anything you think we could improve.
                  </p>
                </div>

                <form action="/feedback/preview/thanks" method="get" className="mt-8">
                  <label htmlFor="feedback" className="mb-2 block text-sm font-medium text-zinc-800">
                    Your feedback
                  </label>
                  <textarea
                    id="feedback"
                    name="feedback"
                    required
                    rows={8}
                    placeholder="Write as much or as little as you like..."
                    className="w-full resize-y rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-sm leading-6 text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100"
                  />
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <p className="text-xs leading-5 text-zinc-400">
                      No survey. No rating scale. Just tell us what you think.
                    </p>
                    <button
                      type="submit"
                      className="shrink-0 rounded-xl bg-zinc-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 focus:outline-none focus:ring-4 focus:ring-zinc-200"
                    >
                      Send feedback
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="py-4 sm:py-8">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white shadow-sm">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <path d="M5 12.5 9.2 16.5 19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                  Feedback sent
                </p>
                <h1 className="text-2xl font-semibold tracking-[-0.035em] text-zinc-950 sm:text-3xl">
                  Thank you
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 sm:text-[15px]">
                  We read every piece of feedback personally, and we genuinely use it to improve Plurilog. Thanks for taking the time to share your experience.
                </p>

                <div className="mt-8">
                  <Link
                    href="/feedback/preview"
                    className="inline-flex rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    Add another thought
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
