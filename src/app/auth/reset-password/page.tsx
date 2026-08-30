'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

export default function ResetPasswordPage() {
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    let isMounted = true;

    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (isMounted) {
          if (session) {
            setHasSession(true);
          }
          setIsCheckingSession(false);
        }
      } catch {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        if (session) {
          setHasSession(true);
        }
        setIsCheckingSession(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        if (error.code === 'weak_password') {
          setErrorMessage('Password must be at least 6 characters and contain letters and numbers.');
        } else {
          setErrorMessage(error.message || 'Failed to update password.');
        }
      } else {
        setIsSuccess(true);
      }
    } catch (err: any) {
      if (err?.code === 'weak_password') {
        setErrorMessage('Password must be at least 6 characters and contain letters and numbers.');
      } else {
        setErrorMessage(err?.message || 'An unexpected error occurred.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-tech-grid bg-white p-4 font-sans text-zinc-900 selection:bg-amber-100 selection:text-zinc-900">
      <div className="relative w-full max-w-sm rounded-2xl bg-white border border-zinc-200/90 p-6 sm:p-7 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-2 mb-4">
          <img src="/logo.svg" alt="Plurilog" className="w-6 h-6 rounded-md object-contain" />
          <span className="font-semibold text-sm tracking-tight text-zinc-900">
            Plurilog
          </span>
        </div>

        {!hasSession ? (
          <div>
            <h1 className="text-base font-semibold text-zinc-900 tracking-tight mb-1">
              Invalid or expired link
            </h1>
            <p className="text-xs text-zinc-500 leading-relaxed mb-5">
              This password reset link is invalid or has expired. Please request a new one from your account settings.
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center w-full px-4 py-2.5 rounded-xl text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer shadow-sm"
            >
              Back to Plurilog
            </Link>
          </div>
        ) : isSuccess ? (
          <div>
            <h1 className="text-base font-semibold text-zinc-900 tracking-tight mb-1">
              Password updated
            </h1>
            <p className="text-xs text-zinc-500 leading-relaxed mb-5">
              Your password has been reset successfully. You can now continue to your dashboard.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center w-full px-4 py-2.5 rounded-xl text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer shadow-sm"
            >
              Go to Dashboard
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <h1 className="text-base font-semibold text-zinc-900 tracking-tight mb-1">
                Set new password
              </h1>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Choose a new password for your Plurilog account.
              </p>
            </div>

            {errorMessage && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200/70 text-xs text-red-700">
                {errorMessage}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  New password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 focus:border-zinc-400 focus:outline-none transition-colors"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Confirm password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 focus:border-zinc-400 focus:outline-none transition-colors"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Setting password…
                </>
              ) : (
                'Set new password'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
