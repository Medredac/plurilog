'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';

type FeedbackPreviewCardProps = {
  initialMode?: 'form' | 'thanks';
  initialFirstName?: string;
  token?: string;
  invalid?: boolean;
  loadError?: boolean;
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
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[112px] sm:h-[120px]">
      <div className="absolute bottom-[-5px] left-1/2 flex -translate-x-1/2 items-end justify-center">
        <img
          src="/robot-head-chatgpt@3x.png"
          alt=""
          aria-hidden="true"
          className="relative z-[1] block h-auto w-[76px] shrink-0 origin-bottom-right -rotate-[7deg] -translate-y-[3px] object-contain sm:w-[84px] sm:-translate-y-[2px]"
        />
        <img
          src="/robot-head-claude@3x.png"
          alt=""
          aria-hidden="true"
          className="relative z-[3] -ml-[7px] block h-auto w-[84px] shrink-0 object-contain sm:w-[92px]"
        />
        <img
          src="/robot-head-gemini@3x.png"
          alt=""
          aria-hidden="true"
          className="relative z-[2] -ml-[7px] block h-auto w-[76px] shrink-0 origin-bottom-left rotate-[7deg] -translate-y-[3px] object-contain sm:w-[84px] sm:-translate-y-[2px]"
        />
      </div>

      {showNote && (
        <img
          src="/note-were-all-ears-with-arrow.svg"
          alt="we’re all ears!"
          className="absolute left-[calc(50%+86px)] top-[-1px] block h-auto w-[118px] object-contain sm:left-[calc(50%+108px)] sm:top-[-7px] sm:w-[150px]"
        />
      )}
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-7 flex items-center gap-2">
      <img
        src="/logo.svg"
        alt=""
        aria-hidden="true"
        className="h-[20px] w-[20px] object-contain sm:h-[21px] sm:w-[21px]"
      />
      <span className="text-[13px] font-semibold tracking-[-0.025em] text-[#1C1B1A]">Plurilog</span>
    </div>
  );
}

function normalizeFirstName(value?: string): string {
  const first = String(value || '').trim().split(/\s+/)[0];
  return first || '';
}

export function FeedbackPreviewCard({
  initialMode = 'form',
  initialFirstName,
  token,
  invalid = false,
  loadError = false,
}: FeedbackPreviewCardProps) {
  const [mode, setMode] = useState<'form' | 'thanks'>(initialMode);
  const [feedback, setFeedback] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [linkUnavailable, setLinkUnavailable] = useState(invalid);

  const firstName = useMemo(
    () => normalizeFirstName(initialFirstName),
    [initialFirstName]
  );

  const canSubmit =
    feedback.trim().length > 0 &&
    feedback.trim().length <= 10_000 &&
    submitState !== 'submitting';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    if (!token) {
      setMode('thanks');
      return;
    }

    setSubmitState('submitting');

    try {
      const response = await fetch(`/api/feedback/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: feedback.trim() }),
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 410) {
          setLinkUnavailable(true);
          setSubmitState('idle');
          return;
        }

        setSubmitState('error');
        return;
      }

      setSubmitState('idle');
      setMode('thanks');
    } catch {
      setSubmitState('error');
    }
  };

  if (linkUnavailable || loadError) {
    return (
      <FeedbackBackdrop>
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[720px] items-center justify-center">
          <div className="relative w-full max-w-[486px] pt-[88px] sm:pt-[96px]">
            <RobotsHeader showNote={false} />

            <section className="relative z-20 min-h-[390px] rounded-[19px] border border-[#DCD9D2] bg-white px-7 pb-10 pt-8 shadow-[0_22px_70px_rgba(28,27,26,0.10)] sm:px-9 sm:pb-11">
              <Brand />

              <div className="flex flex-col items-center px-1 pt-7 text-center">
                <h1 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.04em] text-[#1C1B1A] sm:text-[26px]">
                  {loadError ? 'Something went wrong.' : 'This feedback link is no longer available.'}
                </h1>
                <p className="mt-3 max-w-[330px] text-[13px] leading-[1.6] text-[#6A675F] sm:text-[14px]">
                  {loadError
                    ? 'Please try again in a moment.'
                    : 'The link may have expired or been closed.'}
                </p>

                <Link
                  href="/dashboard"
                  className="mt-7 inline-flex h-10 items-center justify-center rounded-[9px] bg-[#1C1B1A] px-5 text-[12px] font-semibold text-white transition hover:bg-[#353330]"
                >
                  Back to Plurilog
                </Link>
              </div>
            </section>
          </div>
        </div>
      </FeedbackBackdrop>
    );
  }

  if (mode === 'thanks') {
    return (
      <FeedbackBackdrop>
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[720px] items-center justify-center">
          <div className="relative w-full max-w-[486px] pt-[88px] sm:pt-[96px]">
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
                      setSubmitState('idle');
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
        <div className="relative w-full max-w-[486px] pt-[88px] sm:pt-[96px]">
          <RobotsHeader />

          <section className="relative z-20 rounded-[19px] border border-[#DCD9D2] bg-white px-7 pb-8 pt-8 shadow-[0_22px_70px_rgba(28,27,26,0.10)] sm:px-9 sm:pb-10">
            <Brand />

            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.19em] text-[#7D7970]">
              Feedback
            </p>

            <h1 className="max-w-[390px] text-[28px] font-semibold leading-[1.08] tracking-[-0.045em] text-[#1C1B1A] sm:text-[30px]">
              {firstName
                ? `We’d love to hear your feedback, ${firstName}.`
                : 'We’d love to hear your feedback.'}
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
                maxLength={10_000}
                value={feedback}
                onChange={(event) => {
                  setFeedback(event.target.value);
                  if (submitState === 'error') setSubmitState('idle');
                }}
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

              {submitState === 'error' && (
                <p role="alert" className="mt-2 text-[10px] leading-[1.5] text-[#B5473A] sm:text-[11px]">
                  We couldn’t save your feedback. Please try again.
                </p>
              )}

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
                  {submitState === 'submitting' ? 'Sending…' : 'Send feedback'}
                  {submitState !== 'submitting' && <ArrowRight className="h-3.5 w-3.5" />}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </FeedbackBackdrop>
  );
}
