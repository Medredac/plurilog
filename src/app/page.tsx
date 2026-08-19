'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Layers, 
  ArrowRight, 
  Sparkles, 
  Shield, 
  Zap, 
  Compass
} from 'lucide-react';
import { AuthModal } from '../components/AuthModal';
import { createClient } from '../utils/supabase/client';

export default function LandingPage() {
  const router = useRouter();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setIsAuthenticated(true);
        }
      } catch (err) {
        console.error('Session check error:', err);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  const handleOpenAuth = (mode: 'signin' | 'signup') => {
    if (isAuthenticated) {
      router.push('/dashboard');
    } else {
      setAuthMode(mode);
      setIsAuthModalOpen(true);
    }
  };

  const handleAuthSuccess = () => {
    setIsAuthModalOpen(false);
    setIsAuthenticated(true);
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      {/* Navigation Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-zinc-100 px-6 sm:px-12 py-3.5 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 shadow-2xs">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-zinc-900">
            Plurilog
          </span>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {!isCheckingAuth && (
            isAuthenticated ? (
              <button
                onClick={() => router.push('/dashboard')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100/70 border border-amber-200/80 text-zinc-900 font-medium text-xs shadow-2xs transition-colors cursor-pointer"
              >
                <span>Go to Dashboard</span>
                <ArrowRight className="w-3 h-3 text-zinc-600" />
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleOpenAuth('signin')}
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer px-2 py-1"
                >
                  Sign In
                </button>
                <button
                  onClick={() => handleOpenAuth('signup')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
                >
                  <span>Get Started</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </>
            )
          )}
        </div>
      </header>

      {/* Main Landing Canvas with Faint Grid */}
      <main className="flex-1 flex flex-col bg-tech-grid">
        {/* Hero Section */}
        <section className="px-6 sm:px-12 pt-20 pb-16 max-w-4xl mx-auto w-full text-center flex flex-col items-center">
          {/* Subtle Pill Tag */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200/80 text-amber-950 text-xs font-medium mb-6 shadow-2xs">
            <Sparkles className="w-3 h-3 text-amber-700" />
            <span>Multi-Model AI Reasoning</span>
          </div>

          {/* Headline */}
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-zinc-900 leading-tight sm:leading-tight mb-4">
            Multi-model reasoning at your fingertips.
          </h1>

          {/* Subheadline */}
          <p className="text-sm sm:text-base text-zinc-500 font-normal max-w-2xl leading-relaxed mb-8">
            Pose any complex question to Gemini, Claude, and ChatGPT simultaneously. Experience real-time sequential relay, critical nuance, and synthesized clarity.
          </p>

          {/* Primary Action Button */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={() => handleOpenAuth('signup')}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-sm shadow-sm transition-all cursor-pointer hover:shadow"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleOpenAuth('signin')}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200/80 text-zinc-700 font-medium text-sm shadow-2xs transition-colors cursor-pointer"
            >
              <span>Sign In</span>
            </button>
          </div>
        </section>

        {/* Interactive Feature Preview Card */}
        <section className="px-4 sm:px-12 pb-20 max-w-4xl mx-auto w-full">
          <div className="rounded-2xl border border-zinc-200/90 bg-white shadow-md p-4 sm:p-6">
            {/* Header simulation */}
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-100 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className="text-zinc-400 ml-2 font-mono text-[11px]">Council Chamber</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400 bg-zinc-50 px-2 py-0.5 rounded border border-zinc-100">
                Live Relay
              </span>
            </div>

            {/* Model Pills Preview */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-50 border border-zinc-200/70 text-xs">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="font-semibold text-zinc-900">Gemini</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-50 border border-zinc-200/70 text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="font-semibold text-zinc-900">Claude</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-50 border border-zinc-200/70 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="font-semibold text-zinc-900">ChatGPT</span>
              </div>
            </div>

            {/* User prompt preview */}
            <div className="flex justify-end mb-3">
              <div className="bg-stone-100 border border-stone-200/90 rounded-xl p-3 max-w-lg text-xs text-stone-900 leading-relaxed shadow-2xs">
                <span className="text-[10px] text-stone-400 font-semibold block mb-0.5">Prompt</span>
                Should humanity allocate $500B to Mars colonization or exploring Earth’s ocean floor?
              </div>
            </div>

            {/* Sequential AI output snippet */}
            <div className="space-y-2.5">
              <div className="rounded-xl border border-zinc-100 bg-white p-3.5 shadow-2xs text-xs text-zinc-700 leading-relaxed">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-900 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span>Gemini</span>
                </div>
                <p>Earth’s ocean regulates 90% of global climate heat and holds extreme microbial biology. We must prioritize Earth systems.</p>
              </div>

              <div className="rounded-xl border border-zinc-100 bg-white p-3.5 shadow-2xs text-xs text-zinc-700 leading-relaxed">
                <div className="flex items-center gap-1.5 font-semibold text-zinc-900 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span>Claude</span>
                </div>
                <p>While Gemini’s ecological focus is vital, single-point planetary extinction risk necessitates an off-world branch of consciousness.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 3-Column Value Props */}
        <section className="px-6 sm:px-12 py-12 max-w-4xl mx-auto w-full border-t border-zinc-100">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-3 shadow-2xs">
                <Zap className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">Sequential Relay</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Each model observes and critically builds upon preceding responses in real time.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-3 shadow-2xs">
                <Shield className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">Unbiased Perspective</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Eliminate individual hallucination and bias through multi-disciplinary counter-arguments.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-3 shadow-2xs">
                <Compass className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">Actionable Synthesis</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Receive practical conclusions and trade-off evaluations rather than single answers.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Minimal Footer */}
      <footer className="px-6 sm:px-12 py-6 border-t border-zinc-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-md bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 text-[10px]">
            <Layers className="w-2.5 h-2.5" />
          </div>
          <span>Plurilog © {new Date().getFullYear()}</span>
        </div>

        <div className="flex items-center gap-4 text-[11px]">
          <span className="hover:text-zinc-600 transition-colors cursor-pointer">Privacy</span>
          <span className="hover:text-zinc-600 transition-colors cursor-pointer">Terms</span>
          <span className="hover:text-zinc-600 transition-colors cursor-pointer">Documentation</span>
        </div>
      </footer>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        initialMode={authMode}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}
