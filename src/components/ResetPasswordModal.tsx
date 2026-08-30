'use client';
import React, { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  isOpen,
  onClose,
  initialEmail = '',
}) => {
  const [email, setEmail] = useState(initialEmail);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEmail(initialEmail || '');
      setIsSuccess(false);
      setErrorMessage(null);
      setIsLoading(false);
    }
  }, [isOpen, initialEmail]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter an email address.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo,
      });

      if (error) {
        setErrorMessage(error.message || 'Failed to send reset link.');
      } else {
        setIsSuccess(true);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity" />
      <div className="relative w-full max-w-sm rounded-2xl bg-white border border-zinc-200/90 p-5 shadow-xl z-10 animate-in fade-in zoom-in-95 duration-150">
        <h3 className="text-sm font-semibold text-zinc-900 mb-1">Reset password</h3>

        {isSuccess ? (
          <div>
            <p className="text-xs text-zinc-500 leading-relaxed mb-4">
              Check your inbox for a reset link. If an account exists for <span className="font-medium text-zinc-800">{email.trim()}</span>, you’ll receive an email shortly.
            </p>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="text-xs text-zinc-500 leading-relaxed mb-3">
              Enter your email address to receive a link to reset your password.
            </p>

            <div className="mb-4">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 focus:border-zinc-400 focus:outline-none transition-colors"
                disabled={isLoading}
              />
              {errorMessage && (
                <p className="text-xs text-red-600 mt-1.5">{errorMessage}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="px-3.5 py-2 rounded-xl text-xs font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-zinc-900 hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-60"
              >
                {isLoading ? 'Sending…' : 'Send reset link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
