'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Layers, 
  ArrowRight, 
  Sparkles, 
  Shield, 
  Zap, 
  Compass,
  Loader2
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
          router.replace('/dashboard');
          return;
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
        router.replace('/dashboard');
      } else {
        setIsAuthenticated(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [router, supabase]);

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
    router.replace('/dashboard');
  };

  if (isCheckingAuth || isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      {/* Navigation Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-zinc-100 px-6 sm:px-12 py-3.5 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Plurilog" className="w-6 h-6 rounded-md object-contain" />
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
              <button
                onClick={() => handleOpenAuth('signup')}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer"
              >
                <span>Get Started</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )
          )}
        </div>
      </header>

      {/* Main Landing Canvas with Faint Grid */}
      <main className="flex-1 flex flex-col bg-tech-grid">
        {/* Hero Section */}
        <section className="px-6 sm:px-12 pt-20 pb-16 max-w-6xl mx-auto w-full flex flex-col lg:flex-row items-center gap-10 lg:gap-16">
          {/* Left Column: Text & Actions */}
          <div className="w-full lg:w-[45%] text-left flex flex-col items-start">
            {/* Subtle Pill Tag */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200/80 text-amber-950 text-xs font-medium mb-6 shadow-2xs">
              <Sparkles className="w-3 h-3 text-amber-700" />
              <span>The Best AIs. One Room.</span>
            </div>

            {/* Headline */}
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-zinc-900 leading-tight sm:leading-tight mb-4">
              One AI can be confidently wrong. Three rarely are.
            </h1>

            {/* Subheadline */}
            <p className="text-sm sm:text-base text-zinc-500 font-normal max-w-2xl leading-relaxed mb-8">
              Ask once. Watch Gemini, Claude, and ChatGPT debate it live, call out each other&apos;s blind spots, and land on an answer you can actually trust.
            </p>

            {/* Primary Action Button */}
            <div className="flex flex-col sm:flex-row items-start gap-3">
              <button
                onClick={() => handleOpenAuth('signup')}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-sm shadow-sm transition-all cursor-pointer hover:shadow"
              >
                <span>Get Started for Free</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => {}}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200/80 text-zinc-700 font-medium text-sm shadow-2xs transition-colors cursor-pointer"
              >
                <span>Watch Demo</span>
              </button>
            </div>
          </div>

          {/* Right Column: Hero Image */}
          <div className="w-full lg:w-[55%] order-first lg:order-last">
            <img src="/herodraw.svg" alt="" className="w-full h-auto" />
          </div>
        </section>

        {/* Section Header */}
        <section className="px-6 sm:px-12 pt-12 pb-8 max-w-6xl mx-auto w-full text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 leading-snug mb-3">
            How many times have you had to fact-check an AI answer? <br />
            Or cross-check it with another AI to be sure?
          </h2>
          <p className="text-sm sm:text-base text-zinc-500 font-normal leading-relaxed max-w-3xl mx-auto">
            Plurilog is the first platform to put Gemini, Claude, and ChatGPT in the same discussion.
          </p>
          <div className="bg-amber-50 rounded-3xl p-3 mt-8">
            <video
              src="/videodemo.mp4"
              autoPlay
              loop
              muted
              playsInline
              controls={false}
              className="w-full rounded-2xl shadow-md"
            />
          </div>
        </section>

        {/* 3-Column Value Props */}
        <section className="px-6 sm:px-12 py-12 max-w-6xl mx-auto w-full border-t border-zinc-100">
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
