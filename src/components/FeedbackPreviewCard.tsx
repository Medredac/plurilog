'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { PlurilogMark } from '@/components/PlurilogMark';
import { createClient } from '@/utils/supabase/client';

type FeedbackPreviewCardProps = {
  initialMode?: 'form' | 'thanks';
};

export function FeedbackPreviewCard({ initialMode = 'form' }: FeedbackPreviewCardProps) {
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<'form' | 'thanks'>(initialMode);
  const [feedback, setFeedback] = useState('');
  const [firstName, setFirstName] = useState('there');

  useEffect(() => {
    let active = true;

    const loadName = async () => {
      const queryName = new URLSearchParams(window.location.search).get('name')?.trim();
      if (queryName) {
        if (active) setFirstName(queryName.split(/\s+/)[0]);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const metadata = session?.user?.user_metadata;
      const displayName = metadata?.display_name || metadata?.full_name || '';
      const resolved = String(displayName).trim().split(/\s+/)[0];

      if (active && resolved) setFirstName(resolved);
    };

    loadName().catch(() => {});
    return () => {
      active = false;
    };
  }, [supabase]);

  const canSubmit = feedback.trim().length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    // Preview-only interaction for now. The production feedback endpoint can
    // replace this local transition without changing the visual treatment.
    setMode('thanks');
  };

  if (mode === 'thanks') {
    return (
      <main className="plurilog-dashboard bg-tech-grid min-h-screen px-4 py-8 sm:px-6">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[520px] items-center justify-center">
          <section className="relative w-full max-w-[390px] rounded-[18px] border border-[#DEDCD6] bg-white px-7 pb-10 pt-8 shadow-[0_18px_54px_rgba(28,27,26,0.10)] sm:px-10">
            <div className="mb-7 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center">
                <PlurilogMark className="h-5 w-5 text-[#1C1B1A]" />
              </div>
              <span className="text-[12px] font-semibold tracking-[-0.02em] text-[#1C1B1A]">Plurilog</span>
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#DDF5E6] text-[#27A85A]">
                <Check className="h-5 w-5 stroke-[2.4]" />
              </div>
              <h1 className="text-[24px] font-semibold tracking-[-0.04em] text-[#1C1B1A]">
                Thank you!
              </h1>
              <p className="mt-2 max-w-[290px] text-[13px] leading-[1.55] text-[#6A675F]">
                We read every piece of feedback, and yours genuinely helps us make Plurilog better.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <Link
                  href="/dashboard"
                  className="inline-flex h-10 items-center justify-center rounded-[9px] bg-[#1C1B1A] px-4 text-[12px] font-semibold text-white transition hover:bg-[#353330]"
                >
                  Back to Plurilog
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setFeedback('');
                    setMode('form');
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-[9px] border border-[#D9D6CF] bg-white px-4 text-[12px] font-semibold text-[#1C1B1A] transition hover:bg-[#F7F6F3]"
                >
                  Send more feedback
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="plurilog-dashboard bg-tech-grid min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[620px] items-center justify-center">
        <div className="relative w-full max-w-[390px] pt-[94px]">
          <div className="pointer-events-none absolute left-1/2 top-0 z-0 h-[118px] w-[250px] -translate-x-1/2 overflow-hidden">
            <img
              src="/plurilog-robots-sketch.svg"
              alt=""
              aria-hidden="true"
              className="absolute bottom-[-78px] left-1/2 w-[330px] max-w-none -translate-x-1/2"
            />
          </div>

          <div className="pointer-events-none absolute right-[-14px] top-[12px] z-10 w-[132px] rotate-[-4deg] sm:right-[-28px]">
            <div
              className="text-center text-[14px] font-semibold tracking-[-0.04em] text-[#1C1B1A]"
              style={{ fontFamily: '"Comic Sans MS", "Bradley Hand", cursive' }}
            >
              we’re all ears!
            </div>
            <svg
              viewBox="0 0 100 36"
              className="mt-[-1px] h-[34px] w-[100px]"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M86 4C70 19 49 24 23 22"
                stroke="#1C1B1A"
                strokeWidth="2.1"
                strokeLinecap="round"
              />
              <path
                d="M31 15L22 22L32 29"
                stroke="#1C1B1A"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <section className="relative z-20 rounded-[18px] border border-[#DEDCD6] bg-white px-7 pb-8 pt-7 shadow-[0_18px_54px_rgba(28,27,26,0.10)] sm:px-8">
            <div className="mb-7 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center">
                <PlurilogMark className="h-5 w-5 text-[#1C1B1A]" />
              </div>
              <span className="text-[12px] font-semibold tracking-[-0.02em] text-[#1C1B1A]">Plurilog</span>
            </div>

            <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-[#8A867D]">
              Feedback
            </p>
            <h1 className="text-[25px] font-semibold leading-[1.08] tracking-[-0.045em] text-[#1C1B1A]">
              We’d love to hear your feedback, {firstName}.
            </h1>
            <p className="mt-2.5 text-[12px] leading-[1.55] text-[#6A675F]">
              Tell us what worked, what didn’t, or anything you think we could improve.
            </p>

            <form onSubmit={handleSubmit} className="mt-6">
              <label htmlFor="feedback" className="mb-2 block text-[11px] font-semibold text-[#1C1B1A]">
                Your feedback
              </label>
              <textarea
                id="feedback"
                name="feedback"
                rows={6}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="Write as much or as little as you like..."
                className={[
                  'min-h-[138px] w-full resize-y rounded-[13px] bg-[#FBFAF8] px-4 py-3.5',
                  'text-[12px] leading-5 text-[#1C1B1A] outline-none transition-all placeholder:text-[#9A968D]',
                  feedback.trim()
                    ? 'border border-[#3A3936] shadow-[0_0_0_3px_rgba(28,27,26,0.06)]'
                    : 'border border-[#E3E0DA]',
                  'focus:border-[#3A3936] focus:shadow-[0_0_0_3px_rgba(28,27,26,0.06)]',
                ].join(' ')}
              />

              <div className="mt-3.5 flex items-center justify-between gap-3">
                <p className="max-w-[205px] text-[9px] leading-[1.45] text-[#8A867D]">
                  No survey. No rating scale. Just tell us what you think.
                </p>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={[
                    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] px-4 text-[10px] font-semibold transition',
                    canSubmit
                      ? 'bg-[#1C1B1A] text-white hover:bg-[#353330]'
                      : 'cursor-not-allowed bg-[#C9C7C2] text-white',
                  ].join(' ')}
                >
                  Send feedback
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
