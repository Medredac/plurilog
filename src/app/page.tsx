'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Layers, 
  ArrowRight, 
  Sparkles, 
  Loader2,
  MessageCircle,
  MessagesSquare,
  ArrowUpDown,
  RefreshCw,
  Trophy,
  Eye
} from 'lucide-react';
import { AuthModal } from '../components/AuthModal';
import { SiteHeader } from '../components/SiteHeader';
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
      <SiteHeader onGetStartedClick={() => handleOpenAuth('signup')} />

      {/* Main Landing Canvas with Faint Grid */}
      <main className="flex-1 flex flex-col bg-tech-grid">
        {/* Hero Section */}
        <section id="hero" className="px-6 sm:px-12 pt-20 pb-16 max-w-6xl mx-auto w-full flex flex-col lg:flex-row items-center gap-10 lg:gap-16">
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
                onClick={() => handleOpenAuth('signin')}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200/80 text-zinc-700 font-medium text-sm shadow-2xs transition-colors cursor-pointer"
              >
                <span>Sign in</span>
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

        {/* 6-Column Value Props */}
        <section className="px-6 sm:px-12 py-12 max-w-6xl mx-auto w-full border-t border-zinc-100">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 text-center mb-8">
            Made to Get You the Best Answer
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
            <div className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-3 shadow-2xs">
                <MessageCircle className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">They Answer You</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Every model responds directly to what you actually asked — no dodging, no filler.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-[#4880E6]/10 border border-[#4880E6]/20 flex items-center justify-center text-[#4880E6] mb-3 shadow-2xs">
                <MessagesSquare className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">They Answer Each Other</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Models read one another&apos;s responses live and react — agreeing, correcting, or pushing back.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-[#D64A2A]/10 border border-[#D64A2A]/20 flex items-center justify-center text-[#D64A2A] mb-3 shadow-2xs">
                <ArrowUpDown className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">You Set the Order</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Choose who goes first, second, and third. Reorder the discussion however you want.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-[#4880E6]/10 border border-[#4880E6]/20 flex items-center justify-center text-[#4880E6] mb-3 shadow-2xs">
                <RefreshCw className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">Swap Anyone, Anytime</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Not vibing with a model&apos;s take? Remove it or bring in a different one mid-discussion.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-[#D64A2A]/10 border border-[#D64A2A]/20 flex items-center justify-center text-[#D64A2A] mb-3 shadow-2xs">
                <Trophy className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">The Best of All Three</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Walk away with the strongest answer — not just one model&apos;s opinion.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-3 shadow-2xs">
                <Eye className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">Watch It Unfold Live</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                See the full reasoning and back-and-forth in real time, not just a final answer.
              </p>
            </div>
          </div>

          <div className="flex justify-center mt-10">
            <button
              onClick={() => handleOpenAuth('signup')}
              className="px-10 py-3 rounded-full bg-[#4880E6] hover:bg-[#3a6fd0] text-white font-medium text-sm shadow-sm transition-colors cursor-pointer"
            >
              Try it now for free
            </button>
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
          <Link href="/privacy" className="hover:text-zinc-600 transition-colors cursor-pointer">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-zinc-600 transition-colors cursor-pointer">Terms of Service</Link>
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
