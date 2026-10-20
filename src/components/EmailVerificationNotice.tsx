'use client';

import { useEffect, useRef } from 'react';
import { ArrowRight, MailCheck } from 'lucide-react';

export function EmailVerificationNotice({
  email,
  onSignIn,
}: {
  email: string;
  onSignIn: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className="text-center pt-3 pb-1">
      <img src="/logo.svg" alt="Plurilog" className="w-8 h-8 mx-auto mb-6" />
      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#F6D3C9] flex items-center justify-center">
        <MailCheck className="w-8 h-8 text-[#582B1D]" aria-hidden="true" strokeWidth={1.5} />
      </div>
      <h3
        ref={heading}
        id="auth-modal-title"
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight text-[#1C1B1A] outline-none"
      >
        Check your email
      </h3>
      <p className="text-sm text-zinc-500 mt-3">
        We’ve sent a verification link to
      </p>
      <p className="mt-2 px-4 py-3 rounded-xl bg-[#F7F6F3] text-sm font-medium text-[#1C1B1A] break-all">
        {email}
      </p>
      <p className="text-sm leading-relaxed text-zinc-600 mt-4">
        Open the email and click the link to verify your address and finish setting up your account.
      </p>
      <p className="text-xs leading-relaxed text-zinc-500 mt-5">
        Can’t find it? Check your spam or junk folder.
      </p>
      <button
        type="button"
        onClick={onSignIn}
        className="w-full mt-6 py-3 px-4 rounded-xl bg-[#1C1B1A] hover:bg-zinc-800 text-white text-sm font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        Back to sign in
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
