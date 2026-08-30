'use client';

import React, { useState, useEffect } from 'react';
import { X, Layers, ArrowRight, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { createClient } from '../utils/supabase/client';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'signin' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'signin',
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (mode === 'signin') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });

        if (error) {
          throw error;
        }

        if (data.session || data.user) {
          onSuccess();
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
          options: {
            data: {
              display_name: displayName.trim(),
            },
          },
        });

        if (error) {
          if (error.code === 'weak_password') {
            setErrorMessage('Password must be at least 6 characters and contain letters and numbers.');
            setIsLoading(false);
            return;
          }
          throw error;
        }

        if (data.session) {
          onSuccess();
        } else if (data.user && data.user.identities && data.user.identities.length === 0) {
          setErrorMessage('An account with this email already exists. Please sign in.');
        } else {
          setSuccessMessage("Account created! We've sent a confirmation link to your email — click it to activate your account.");
          setTimeout(() => {
            if (data.session) {
              onSuccess();
            }
          }, 1500);
        }
      }
    } catch (err: any) {
      console.error('Supabase auth error:', err);
      if (err?.code === 'weak_password') {
        setErrorMessage('Password must be at least 6 characters and contain letters and numbers.');
      } else {
        setErrorMessage(err?.message || 'Authentication failed. Please check your credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setErrorMessage(error.message);
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="fixed inset-0 bg-black/20 backdrop-blur-xs transition-opacity"
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-sm rounded-2xl bg-white border border-zinc-200/90 p-6 shadow-lg z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
          title="Close modal"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Logo & Header */}
        <div className="flex flex-col items-center text-center mb-5">
          <img src="/logo.svg" alt="Plurilog" className="w-8 h-8 rounded-lg object-contain mb-2.5" />
          <h3 className="font-semibold text-base text-zinc-900 tracking-tight">
            {mode === 'signin' ? 'Sign in to Plurilog' : 'Create your account'}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {mode === 'signin' 
              ? 'Enter your credentials to access your discussions.' 
              : 'Sign up to start collaborative AI deliberations.'}
          </p>
        </div>

        {/* Error / Success Notifications */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="leading-snug">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-600" />
            <span className="leading-snug">{successMessage}</span>
          </div>
        )}

        {/* Google OAuth Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="w-full py-2 px-3 rounded-lg bg-white hover:bg-zinc-50 border border-zinc-200/80 text-zinc-700 font-medium text-xs shadow-2xs transition-colors flex items-center justify-center gap-2 cursor-pointer mb-3 disabled:opacity-60"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          <span>Continue with Google</span>
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px bg-zinc-200" />
          <span className="text-[10px] text-zinc-400 font-medium">OR</span>
          <div className="flex-1 h-px bg-zinc-200" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label className="block text-[11px] font-medium text-zinc-700 mb-1">
                Display name
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="w-full px-3 py-2 text-xs text-zinc-900 rounded-lg border border-zinc-200/80 bg-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition-all"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-zinc-700 mb-1">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 text-xs text-zinc-900 rounded-lg border border-zinc-200/80 bg-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition-all"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-700 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 text-xs text-zinc-900 rounded-lg border border-zinc-200/80 bg-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer mt-1 disabled:opacity-60"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{mode === 'signin' ? 'Signing in...' : 'Creating account...'}</span>
              </>
            ) : (
              <>
                <span>{mode === 'signin' ? 'Sign In' : 'Sign Up'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </form>

        {/* Toggle Mode Switcher */}
        <div className="mt-4 pt-3 border-t border-zinc-100 text-center">
          <p className="text-xs text-zinc-500">
            {mode === 'signin' ? "Don't have an account?" : "Already have an account?"}{' '}
            <button
              type="button"
              onClick={toggleMode}
              className="font-medium text-zinc-900 hover:underline cursor-pointer ml-0.5"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
