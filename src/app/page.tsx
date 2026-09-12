'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  Eye,
  AlertCircle,
  X,
  Check,
  ChevronDown
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { AuthModal } from '../components/AuthModal';
import { SiteHeader } from '../components/SiteHeader';
import { createClient } from '../utils/supabase/client';

const faqItems = [
  {
    question: "Do I need separate subscriptions to ChatGPT, Claude and Gemini?",
    answer: [
      "No. You do not need individual paid subscriptions to ChatGPT, Claude or Gemini to use them through Plurilog.",
      "One Plurilog subscription gives you access to models from OpenAI, Anthropic and Google inside the same platform, subject to your Plurilog plan limits. You do not need to maintain three separate AI subscriptions just to use multiple leading AI models together."
    ]
  },
  {
    question: "Can I use all three AIs in one place?",
    answer: [
      "Yes. That is the core of Plurilog.",
      "Instead of opening separate AI apps, copying the same prompt into each one and manually comparing the answers, Plurilog brings all three AIs into one shared discussion.",
      "They do not only respond to your prompt. They can also interact with one another by seeing and responding to what the other AIs have already said, allowing the discussion to develop across multiple perspectives."
    ]
  },
  {
    question: "Do the AIs see each other's answers?",
    answer: [
      "Yes. When multiple AIs participate in a discussion, later models can see the answers that came before them.",
      "This means an AI can tell you whether it agrees with another AI, point out something the other AI may have missed, identify a possible error, or explain why it reaches a different conclusion.",
      "It is similar to asking one AI a question, taking its answer to another AI and saying, \"The other AI said this about the topic. What do you think?\" Plurilog handles that exchange automatically inside the same ongoing conversation."
    ]
  },
  {
    question: "Are these real AI models from OpenAI, Google and Anthropic?",
    answer: [
      "Yes. Plurilog uses official API-accessible AI models from OpenAI, Google and Anthropic. They are not Plurilog-built imitations presented under those names.",
      "Plurilog provides the system around the models: the shared discussion, model orchestration, persistent context, document retrieval and interface that allow multiple AIs to work together in one conversation."
    ]
  },
  {
    question: "Which AI models does Plurilog use?",
    answer: [
      "Plurilog uses current high-quality large language models (LLMs) from OpenAI, Anthropic and Google.",
      "The exact model versions can evolve as newer and more capable models become available rather than permanently locking Plurilog to one generation of AI.",
      "Plurilog also uses intelligent model routing and fallback models to help keep discussions running when a particular model is temporarily unavailable."
    ]
  },
  {
    question: "Can I choose which AIs respond?",
    answer: [
      "Yes. You control your AI panel.",
      "You can turn individual AIs on or off and choose the order in which they respond. You might start with all three to get several perspectives, then narrow the panel to one or two when you want a more focused exchange.",
      "You can change the panel without abandoning the existing conversation or starting over."
    ]
  },
  {
    question: "Does Plurilog support file and image uploads?",
    answer: [
      "Yes. Plurilog supports multimodal AI discussions involving documents, images and text alongside normal conversation.",
      "You can work with PDFs, Word documents, images and common text-based files inside a discussion. Plurilog preserves the source files and creates searchable representations that help the AI models retrieve relevant information when it is needed.",
      "This means you can ask questions about a PDF, analyze an image, work through a document, and continue discussing those materials with different AIs without repeatedly uploading or copying the same content between separate apps."
    ]
  },
  {
    question: "Does Plurilog support voice conversations?",
    answer: [
      "Plurilog does not currently offer live two-way voice conversations with the AI models.",
      "It does, however, support microphone dictation. You can speak instead of typing, and Plurilog converts what you say into text before sending it into the discussion.",
      "This gives you a faster way to prompt the AIs by voice while keeping the conversation itself in a readable text format."
    ]
  },
  {
    question: "Is Plurilog just an AI comparison tool?",
    answer: [
      "No. Comparing AI answers is useful, but Plurilog is designed around something broader: an ongoing AI panel.",
      "The goal is not simply to place three answers side by side. The AIs participate in the same evolving conversation, share relevant context, and can respond to ideas introduced earlier in the discussion.",
      "You stay in one conversation while controlling which models participate and when they respond."
    ]
  },
  {
    question: "Is Plurilog affiliated with OpenAI, Anthropic or Google?",
    answer: [
      "No. Plurilog is an independent product and is not affiliated with, endorsed by, or operated by OpenAI, Anthropic or Google.",
      "Plurilog accesses supported AI models through API services and combines them through its own conversation, model-routing, document and user-interface systems.",
      "ChatGPT and OpenAI are associated with OpenAI, Claude with Anthropic, and Gemini with Google."
    ]
  },
  {
    question: "Is using the AI models through Plurilog the same as using their official apps?",
    answer: [
      "Not exactly.",
      "Plurilog gives you access to AI models from OpenAI, Anthropic and Google through APIs, but Plurilog is its own product with its own features and interface. Features available only inside the providers' official applications may therefore be different or unavailable.",
      "Plurilog is built specifically around the multi-model experience: shared discussions, model selection and ordering, persistent context, multimodal document and image workflows, and multiple AI perspectives in one place."
    ]
  },
  {
    question: "How does Plurilog handle my data?",
    answer: [
      "You stay in control of your data. Plurilog stores your discussions and related conversation data so features such as conversation history, shared context, memory, and document and image retrieval can continue working when you return to a discussion.",
      "When you delete a discussion, its messages, conversation-specific memory, document and retrieval data, image-related data, and associated uploaded files are automatically removed from Plurilog's active database and primary storage.",
      "To generate AI responses, relevant conversation content may be sent through OpenRouter to the selected AI providers for processing. Data handled by those external providers is subject to their respective API and data-retention policies."
    ]
  },
  {
    question: "Does using multiple AIs guarantee that the answer is correct?",
    answer: [
      "No AI system can guarantee that every answer is correct.",
      "Using multiple AI models can make it easier to uncover conflicting assumptions, missing information and reasoning errors that might go unnoticed when relying on a single model. Different AIs may approach the same question differently, giving you additional perspectives to consider.",
      "However, agreement between multiple AIs is not the same as independent verification. For important factual decisions, reliable evidence and primary sources should still take priority over the models simply agreeing with one another."
    ]
  }
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer.join(" "),
    },
  })),
};

function AuthParamsHandler({ 
  onTriggerSignup, 
  onAuthError 
}: { 
  onTriggerSignup: () => void; 
  onAuthError: () => void; 
}) {
  const searchParams = useSearchParams();
  const hasTriggeredSignupRef = useRef(false);
  const hasTriggeredAuthErrorRef = useRef(false);

  useEffect(() => {
    if (searchParams.get('signup') === 'true' && !hasTriggeredSignupRef.current) {
      hasTriggeredSignupRef.current = true;
      onTriggerSignup();
    }
    if (searchParams.get('auth_error') === 'true' && !hasTriggeredAuthErrorRef.current) {
      hasTriggeredAuthErrorRef.current = true;
      onAuthError();
    }
  }, [searchParams, onTriggerSignup, onAuthError]);

  return null;
}

export default function LandingPage() {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authErrorBanner, setAuthErrorBanner] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const supabase = createClient();

  const handleAuthError = () => {
    setAuthErrorBanner('Something went wrong signing you in. Please try again.');
    handleOpenAuth('signin');
  };

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

  const scrollRevealProps = (delay = 0) => ({
    initial: {
      opacity: shouldReduceMotion ? 1 : 0.25,
      y: shouldReduceMotion ? 0 : 18,
      filter: shouldReduceMotion ? 'blur(0px)' : 'blur(6px)',
    },
    whileInView: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
    },
    transition: {
      duration: shouldReduceMotion ? 0.15 : 0.45,
      delay: shouldReduceMotion ? 0 : delay,
      ease: [0.21, 0.47, 0.32, 0.98] as const,
    },
    viewport: {
      once: false,
      amount: 0.05,
      margin: '0px' as const,
    },
  });

  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      <Suspense fallback={null}>
        <AuthParamsHandler 
          onTriggerSignup={() => handleOpenAuth('signup')} 
          onAuthError={handleAuthError} 
        />
      </Suspense>

      {/* Navigation Header */}
      <SiteHeader onGetStartedClick={() => handleOpenAuth('signup')} />

      {/* Main Landing Canvas with Faint Grid */}
      <main className="flex-1 flex flex-col bg-tech-grid">
        {/* Auth Error Banner */}
        {authErrorBanner && (
          <div className="max-w-6xl mx-auto w-full px-6 sm:px-12 pt-6">
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200/90 text-red-700 text-xs sm:text-sm flex items-center justify-between shadow-2xs animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{authErrorBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setAuthErrorBanner(null)}
                className="p-1 rounded-lg text-red-400 hover:text-red-700 hover:bg-red-100/60 transition-colors cursor-pointer"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Hero Section */}
        <section id="hero" className="px-6 sm:px-12 pt-20 pb-16 max-w-6xl mx-auto w-full flex flex-col lg:flex-row items-center gap-10 lg:gap-16">
          {/* Left Column: Text & Actions */}
          <div className="w-full lg:w-[45%] text-left flex flex-col items-start">
            {/* Subtle Pill Tag */}
            <motion.div
              initial={{
                opacity: shouldReduceMotion ? 1 : 0.25,
                y: shouldReduceMotion ? 0 : 18,
                filter: shouldReduceMotion ? 'blur(0px)' : 'blur(6px)',
              }}
              whileInView={{
                opacity: 1,
                y: 0,
                filter: 'blur(0px)',
              }}
              viewport={{
                once: false,
                amount: 0.05,
              }}
              transition={{
                duration: shouldReduceMotion ? 0.15 : 0.45,
                delay: shouldReduceMotion ? 0 : 0.07,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200/80 text-amber-950 text-xs font-medium mb-6 shadow-2xs"
            >
              <Sparkles className="w-3 h-3 text-amber-700" />
              <span>The Best AIs. One Room.</span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{
                opacity: shouldReduceMotion ? 1 : 0.25,
                y: shouldReduceMotion ? 0 : 18,
                filter: shouldReduceMotion ? 'blur(0px)' : 'blur(6px)',
              }}
              whileInView={{
                opacity: 1,
                y: 0,
                filter: 'blur(0px)',
              }}
              viewport={{
                once: false,
                amount: 0.05,
              }}
              transition={{
                duration: shouldReduceMotion ? 0.15 : 0.45,
                delay: shouldReduceMotion ? 0 : 0.12,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
              className="text-3xl sm:text-5xl font-bold tracking-tight text-zinc-900 leading-tight sm:leading-tight mb-4"
            >
              One AI can be confidently wrong. Three rarely are.
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{
                opacity: shouldReduceMotion ? 1 : 0.25,
                y: shouldReduceMotion ? 0 : 18,
                filter: shouldReduceMotion ? 'blur(0px)' : 'blur(6px)',
              }}
              whileInView={{
                opacity: 1,
                y: 0,
                filter: 'blur(0px)',
              }}
              viewport={{
                once: false,
                amount: 0.05,
              }}
              transition={{
                duration: shouldReduceMotion ? 0.15 : 0.45,
                delay: shouldReduceMotion ? 0 : 0.18,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
              className="text-sm sm:text-base text-zinc-500 font-normal max-w-2xl leading-relaxed mb-8"
            >
              Ask once. Watch Gemini, Claude, and ChatGPT debate it live, call out each other&apos;s blind spots, and land on an answer you can actually trust.
            </motion.p>

            {/* Primary Action Button */}
            <motion.div
              initial={{
                opacity: shouldReduceMotion ? 1 : 0.25,
                y: shouldReduceMotion ? 0 : 18,
                filter: shouldReduceMotion ? 'blur(0px)' : 'blur(6px)',
              }}
              whileInView={{
                opacity: 1,
                y: 0,
                filter: 'blur(0px)',
              }}
              viewport={{
                once: false,
                amount: 0.05,
              }}
              transition={{
                duration: shouldReduceMotion ? 0.15 : 0.45,
                delay: shouldReduceMotion ? 0 : 0.24,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
              className="flex flex-col sm:flex-row items-start gap-3"
            >
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
            </motion.div>
          </div>

          {/* Right Column: Hero Image */}
          <motion.div
            initial={{
              opacity: shouldReduceMotion ? 1 : 0.25,
              y: shouldReduceMotion ? 0 : 18,
              filter: shouldReduceMotion ? 'blur(0px)' : 'blur(6px)',
            }}
            whileInView={{
              opacity: 1,
              y: 0,
              filter: 'blur(0px)',
            }}
            viewport={{
              once: false,
              amount: 0.05,
            }}
            transition={{
              duration: shouldReduceMotion ? 0.15 : 0.5,
              delay: shouldReduceMotion ? 0 : 0.04,
              ease: [0.21, 0.47, 0.32, 0.98],
            }}
            className="w-full lg:w-[55%] order-first lg:order-last"
          >
            <img src="/herodraw.svg" alt="" className="w-full h-auto" />
          </motion.div>
        </section>

        {/* Section Header */}
        <section id="about" className="px-6 sm:px-12 pt-12 pb-8 max-w-6xl mx-auto w-full text-center scroll-mt-16">
          <motion.div {...scrollRevealProps(0.30)}>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 leading-snug mb-3">
              How many times have you had to fact-check an AI answer? <br />
              Or cross-check it with another AI to be sure?
            </h2>
            <p className="text-sm sm:text-base text-zinc-500 font-normal leading-relaxed max-w-3xl mx-auto">
              Plurilog is the first platform to put Gemini, Claude, and ChatGPT in the same discussion.
            </p>
          </motion.div>
          <motion.div {...scrollRevealProps(0.38)} className="bg-amber-50 rounded-3xl p-3 mt-8">
            <video
              src="/videodemo.mp4"
              autoPlay
              loop
              muted
              playsInline
              controls={false}
              className="w-full rounded-2xl shadow-md"
            />
          </motion.div>
        </section>

        {/* Full Control Feature Section */}
        <section className="px-6 sm:px-12 py-16 max-w-6xl mx-auto w-full flex flex-col lg:flex-row items-center lg:items-start gap-10 lg:gap-16 border-t border-zinc-100">
          {/* Left Column: Text */}
          <div className="w-full lg:w-[45%] text-left flex flex-col items-start">
            <motion.div {...scrollRevealProps(0)}>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 leading-tight mb-4">
                You&apos;re in Full Control of Your AI Panel
              </h2>
              <div className="space-y-4 text-sm sm:text-base text-zinc-600 font-normal leading-relaxed">
                <p>
                  Choose exactly which AI models take part in every discussion. Turn ChatGPT, Claude or Gemini on or off at any time, change the order they respond in, and focus the conversation on the model you want—without starting over.
                </p>
                <p>
                  Start with all three models for multiple perspectives, then narrow the panel when you want a more focused exchange. You decide which models respond and the order they join the conversation.
                </p>
                <p>
                  Everything stays in one ongoing discussion, so you do not have to copy prompts between separate AI chats just because you want a different model to respond next.
                </p>
              </div>
            </motion.div>

            <motion.div {...scrollRevealProps(0.07)} className="w-full">
              <video
                src="/showAIs.mp4"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                controls={false}
                className="mt-6 w-full max-w-[408px] h-auto rounded-lg border border-zinc-200 shadow-sm"
              />
            </motion.div>

            {/* Feature List + CTA */}
            <motion.div {...scrollRevealProps(0.14)} className="w-full flex flex-col items-start">
              <ul className="mt-4 space-y-3 text-xs sm:text-sm font-medium text-zinc-700">
                <li className="flex items-center gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-blue-50 border border-blue-200/80 flex items-center justify-center text-[#4880E6] shrink-0 shadow-2xs">
                    <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                  </div>
                  <span>Turn individual AI models on or off</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-blue-50 border border-blue-200/80 flex items-center justify-center text-[#4880E6] shrink-0 shadow-2xs">
                    <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                  </div>
                  <span>Reorder ChatGPT, Claude and Gemini</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-blue-50 border border-blue-200/80 flex items-center justify-center text-[#4880E6] shrink-0 shadow-2xs">
                    <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                  </div>
                  <span>Keep the conversation in one shared discussion</span>
                </li>
              </ul>

              <button
                onClick={() => handleOpenAuth('signup')}
                className="mt-6 flex items-center gap-2 px-6 py-3 rounded-xl bg-[#D94726] hover:bg-[#C13D21] text-white font-medium text-sm shadow-sm transition-all cursor-pointer hover:shadow"
              >
                <span>Start your AI panel</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          </div>

          {/* Right Column: Video Container */}
          <div className="w-full lg:w-[55%] flex justify-center">
            <motion.div
              {...scrollRevealProps(0.06)}
              className="w-fit bg-blue-50/70 border border-blue-100/80 rounded-[34px] p-2.5 sm:p-3 flex items-center justify-center shadow-2xs"
            >
              <video
                src="/phonetestvideo.mp4"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                controls={false}
                className="w-full max-w-[340px] sm:max-w-[380px] lg:max-w-[400px] h-auto rounded-[28px] shadow-md object-contain"
              />
            </motion.div>
          </div>
        </section>

        {/* 6-Column Value Props */}
        <section className="px-6 sm:px-12 py-12 max-w-6xl mx-auto w-full border-t border-zinc-100">
          <motion.h2
            {...scrollRevealProps(0)}
            className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 text-center mb-8"
          >
            Made to Get You the Best Answer
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
            <motion.div {...scrollRevealProps(0.04)} className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-3 shadow-2xs">
                <MessageCircle className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">They Answer You</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Every model responds directly to what you actually asked — no dodging, no filler.
              </p>
            </motion.div>

            <motion.div {...scrollRevealProps(0.08)} className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-[#4880E6]/10 border border-[#4880E6]/20 flex items-center justify-center text-[#4880E6] mb-3 shadow-2xs">
                <MessagesSquare className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">They Answer Each Other</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Models read one another&apos;s responses live and react — agreeing, correcting, or pushing back.
              </p>
            </motion.div>

            <motion.div {...scrollRevealProps(0.12)} className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-[#D64A2A]/10 border border-[#D64A2A]/20 flex items-center justify-center text-[#D64A2A] mb-3 shadow-2xs">
                <ArrowUpDown className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">You Set the Order</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Choose who goes first, second, and third. Reorder the discussion however you want.
              </p>
            </motion.div>

            <motion.div {...scrollRevealProps(0.16)} className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-[#4880E6]/10 border border-[#4880E6]/20 flex items-center justify-center text-[#4880E6] mb-3 shadow-2xs">
                <RefreshCw className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">Swap Anyone, Anytime</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Not vibing with a model&apos;s take? Remove it or bring in a different one mid-discussion.
              </p>
            </motion.div>

            <motion.div {...scrollRevealProps(0.20)} className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-[#D64A2A]/10 border border-[#D64A2A]/20 flex items-center justify-center text-[#D64A2A] mb-3 shadow-2xs">
                <Trophy className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">The Best of All Three</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Walk away with the strongest answer — not just one model&apos;s opinion.
              </p>
            </motion.div>

            <motion.div {...scrollRevealProps(0.24)} className="p-4 rounded-xl bg-white border border-zinc-100 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-3 shadow-2xs">
                <Eye className="w-4 h-4" />
              </div>
              <h3 className="font-semibold text-sm text-zinc-900 mb-1">Watch It Unfold Live</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                See the full reasoning and back-and-forth in real time, not just a final answer.
              </p>
            </motion.div>
          </div>

          <motion.div {...scrollRevealProps(0.28)} className="flex justify-center mt-10">
            <button
              onClick={() => handleOpenAuth('signup')}
              className="px-10 py-3 rounded-full bg-[#4880E6] hover:bg-[#3a6fd0] text-white font-medium text-sm shadow-sm transition-colors cursor-pointer"
            >
              Try it now for free
            </button>
          </motion.div>
        </section>

        {/* FAQ Section */}
        <section
          id="faq"
          className="w-full border-t border-zinc-100"
        >
          <div className="max-w-4xl mx-auto px-6 sm:px-12 py-16">
            <motion.div {...scrollRevealProps(0)}>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 text-center">
                Frequently Asked Questions
              </h2>
              <p className="mt-3 max-w-2xl mx-auto text-center text-sm sm:text-base text-zinc-500 leading-relaxed">
                Everything you need to know about using Plurilog.
              </p>
            </motion.div>

            <motion.div {...scrollRevealProps(0.08)} className="mt-10 space-y-3">
              {faqItems.map((item, index) => {
                const isOpen = openFaqIndex === index;
                return (
                  <div
                    key={index}
                    className="rounded-2xl border border-zinc-200/80 bg-white/80 overflow-hidden transition-colors duration-200 hover:bg-zinc-100/70"
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`faq-answer-${index}`}
                      onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                      className="group w-full flex items-center justify-between gap-6 px-5 sm:px-6 py-5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
                    >
                      <span className="text-sm sm:text-base font-medium text-zinc-700 group-hover:text-zinc-900 transition-colors">
                        {item.question}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 sm:w-5 sm:h-5 text-zinc-400 shrink-0 transition-transform duration-300 ease-out group-hover:text-zinc-600 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    <div
                      id={`faq-answer-${index}`}
                      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                        isOpen
                          ? 'grid-rows-[1fr] opacity-100'
                          : 'grid-rows-[0fr] opacity-0'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="px-5 sm:px-6 pb-5 text-sm text-zinc-500 leading-relaxed space-y-3">
                          {item.answer.map((paragraph, pIdx) => (
                            <p key={pIdx}>{paragraph}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* FAQ Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
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
