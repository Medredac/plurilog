'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

type FeedbackPreviewCardProps = {
  initialMode?: 'form' | 'thanks';
};

function FeedbackBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="min-h-screen overflow-x-hidden px-4 py-8 text-[#1C1B1A] sm:px-6 sm:py-10"
      style={{
        fontFamily: 'var(--font-poppins), Poppins, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        backgroundColor: '#F7F6F3',
        backgroundImage:
          'linear-gradient(to right, rgba(28,27,26,0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(28,27,26,0.055) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }}
    >
      {children}
    </main>
  );
}

function RobotsHeader({ showNote = true }: { showNote?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[120px] sm:h-[130px]">
      <div className="absolute bottom-[-1px] left-1/2 flex -translate-x-1/2 items-end justify-center">
        <img
          src="/robot-head-chatgpt@3x.png"
          alt=""
          aria-hidden="true"
          className="block h-auto w-[78px] shrink-0 object-contain sm:w-[86px]"
        />
        <img
          src="/robot-head-claude@3x.png"
          alt=""
          aria-hidden="true"
          className="-ml-[2px] block h-auto w-[82px] shrink-0 object-contain sm:w-[90px]"
        />
        <img
          src="/robot-head-gemini@3x.png"
          alt=""
          aria-hidden="true"
          className="-ml-[2px] block h-auto w-[78px] shrink-0 object-contain sm:w-[86px]"
        />
      </div>

      {showNote && (
        <img
          src="/note-were-all-ears@3x.png"
          alt="we’re all ears!"
          className="absolute left-[calc(50%+112px)] top-[25px] block h-auto w-[124px] object-contain sm:left-[calc(50%+126px)] sm:top-[28px] sm:w-[142px]"
        />
      )}
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-7 flex items-center gap-2">
      <img
        src="/logopngpluri.png"
        alt=""
        aria-hidden="true"
        className="h-[22px] w-[22px] object-contain"
      />
      <span className="text-[13px] font-semibold tracking-[-0.025em] text-[#1C1B1A]">Plurilog</span>
    </div>
  );
}

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
    setMode('thanks');
  };

  if (mode === 'thanks') {
    return (
      <FeedbackBackdrop>
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[720px] items-center justify-center">
          <div className="relative w-full max-w-[486px] pt-[120px] sm:pt-[130px]">
            <RobotsHeader showNote={false} />

            <section className="relative z-20 min-h-[430px] rounded-[19px] border border-[#DCD9D2] bg-white px-7 pb-10 pt-8 shadow-[0_22px_70px_rgba(28,27,26,0.10)] sm:min-h-[455px] sm:px-9 sm:pb-11 sm:pt-8">
              <Brand />

              <div className="flex flex-col items-center px-1 pt-3 text-center sm:pt-5">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#DDF5E6] text-[#27A85A]">
                  <Check className="h-5 w-5 stroke-[2.5]" />
                </div>

                <h1 className="text-[25px] font-semibold leading-[1.1] tracking-[-0.045em] text-[#1C1B1A] sm:text-[27px]">
                  Thank you!
                </h1>

                <p className="mt-3 max-w-[330px] text-[13px] leading-[1.6] text-[#6A675F] sm:text-[14px]">
                  We read every piece of feedback. Yours genuinely helps us understand what to improve and make Plurilog better.
                </p>

                <div className="mt-7 flex w-full flex-col items-stretch justify-center gap-2.5 sm:w-auto sm:flex-row sm:items-center">
                  <Link
                    href="/dashboard"
                    className="inline-flex h-10 items-center justify-center rounded-[9px] bg-[#1C1B1A] px-5 text-[12px] font-semibold text-white transition hover:bg-[#353330]"
                  >
                    Back to Plurilog
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setFeedback('');
                      setMode('form');
                    }}
                    className="inline-flex h-10 items-center justify-center rounded-[9px] border border-[#D9D6CF] bg-white px-5 text-[12px] font-semibold text-[#1C1B1A] transition hover:bg-[#F7F6F3]"
                  >
                    Send more feedback
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </FeedbackBackdrop>
    );
  }

  return (
    <FeedbackBackdrop>
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[720px] items-center justify-center">
        <div className="relative w-full max-w-[486px] pt-[120px] sm:pt-[130px]">
          <RobotsHeader />

          <section className="relative z-20 rounded-[19px] border border-[#DCD9D2] bg-white px-7 pb-8 pt-8 shadow-[0_22px_70px_rgba(28,27,26,0.10)] sm:px-9 sm:pb-10">
            <Brand />

            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.19em] text-[#7D7970]">
              Feedback
            </p>

            <h1 className="max-w-[390px] text-[28px] font-semibold leading-[1.08] tracking-[-0.045em] text-[#1C1B1A] sm:text-[30px]">
              We’d love to hear your feedback, {firstName}.
            </h1>

            <p className="mt-3 max-w-[390px] text-[13px] leading-[1.55] text-[#6A675F] sm:text-[14px]">
              Tell us what worked, what didn’t, or anything you think we could improve.
            </p>

            <form onSubmit={handleSubmit} className="mt-7">
              <label htmlFor="feedback" className="mb-2.5 block text-[11px] font-semibold text-[#1C1B1A] sm:text-[12px]">
                Your feedback
              </label>

              <textarea
                id="feedback"
                name="feedback"
                rows={7}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="Write as much or as little as you like..."
                className={[
                  'min-h-[146px] w-full resize-y rounded-[13px] bg-[#FBFAF8] px-4 py-3.5',
                  'text-[12px] leading-5 text-[#1C1B1A] outline-none transition-all placeholder:text-[#8F8B82] sm:min-h-[154px] sm:text-[13px]',
                  feedback.trim()
                    ? 'border border-[#2C2B29] shadow-[0_0_0_3px_rgba(28,27,26,0.06)]'
                    : 'border border-[#E0DDD6]',
                  'focus:border-[#2C2B29] focus:shadow-[0_0_0_3px_rgba(28,27,26,0.06)]',
                ].join(' ')}
              />

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[9.5px] leading-[1.5] text-[#7D7970] sm:max-w-[235px] sm:text-[10px]">
                  No survey. No rating scale. Just tell us what you think.
                </p>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={[
                    'inline-flex h-10 items-center justify-center gap-2 self-stretch rounded-[9px] px-5 text-[11px] font-semibold transition sm:self-auto',
                    canSubmit
                      ? 'bg-[#1C1B1A] text-white hover:bg-[#353330]'
                      : 'cursor-not-allowed bg-[#BDBBB7] text-white',
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
    </FeedbackBackdrop>
  );
}
