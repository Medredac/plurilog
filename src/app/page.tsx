'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowRight, 
  Sparkles, 
  MessagesSquare,
  FileText,
  Edit3,
  Image as ImageIcon,
  Search,
  Globe2,
  AlertCircle, 
  X, 
  Check, 
  ChevronDown,
  Play 
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { AuthModal } from '../components/AuthModal';
import { DemoVideoModal } from '../components/DemoVideoModal';
import { SiteHeader } from '../components/SiteHeader';
import { PlurilogMark } from '@/components/PlurilogMark';
import { RoleMarquee } from '@/components/RoleMarquee';
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
    question: "Is my data private?",
    answer: [
      "Your conversations are private to your account and removable at any time. Only the data needed to provide Plurilog’s features and AI responses is processed. AI requests are handled securely through model providers, and your conversations and prompts are never used for advertising."
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
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authErrorBanner, setAuthErrorBanner] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [authRedirectTarget, setAuthRedirectTarget] = useState('/dashboard');
  const authRedirectTargetRef = useRef<string>('/dashboard');

  const supabase = createClient();

  const handleAuthError = () => {
    setAuthErrorBanner('Something went wrong signing you in. Please try again.');
    handleOpenAuth('signin');
  };

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setIsAuthenticated(true);
          router.replace('/dashboard');
        } else {
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('Session check error:', err);
      }
    };

    checkSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setIsAuthenticated(true);
        if (event === 'SIGNED_IN') {
          const target = authRedirectTargetRef.current || '/dashboard';
          router.replace(target);
        }
      } else {
        setIsAuthenticated(false);
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [router, supabase]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const targetId = window.location.hash.slice(1);
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        requestAnimationFrame(() => {
          targetEl.scrollIntoView({ behavior: 'smooth' });
        });
      }
    }
  }, []);

  const handleOpenAuth = (mode: 'signin' | 'signup') => {
    authRedirectTargetRef.current = '/dashboard';
    setAuthRedirectTarget('/dashboard');
    if (isAuthenticated) {
      router.push('/dashboard');
    } else {
      setAuthMode(mode);
      setIsAuthModalOpen(true);
      if (mode === 'signup') {
        window.fbq?.('trackCustom', 'SignupStarted');
      }
    }
  };

  const handleGetPlus = () => {
    if (isAuthenticated) {
      router.push('/dashboard?upgrade=true');
    } else {
      authRedirectTargetRef.current = '/dashboard?upgrade=true';
      setAuthRedirectTarget('/dashboard?upgrade=true');
      setAuthMode('signup');
      setIsAuthModalOpen(true);
      window.fbq?.('trackCustom', 'SignupStarted');
    }
  };

  const handleAuthSuccess = () => {
    setIsAuthModalOpen(false);
    setIsAuthenticated(true);
    const target = authRedirectTargetRef.current || '/dashboard';
    router.replace(target);
  };

  const scrollRevealProps = (delay = 0) => ({
    initial: {
      opacity: shouldReduceMotion ? 1 : 0,
      y: shouldReduceMotion ? 0 : 12,
      filter: shouldReduceMotion ? 'blur(0px)' : 'blur(4px)',
    },
    whileInView: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
    },
    transition: {
      duration: shouldReduceMotion ? 0.15 : 0.32,
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
                opacity: shouldReduceMotion ? 1 : 0,
                y: shouldReduceMotion ? 0 : 12,
                filter: shouldReduceMotion ? 'blur(0px)' : 'blur(4px)',
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
                duration: shouldReduceMotion ? 0.15 : 0.32,
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
                opacity: shouldReduceMotion ? 1 : 0,
                y: shouldReduceMotion ? 0 : 12,
                filter: shouldReduceMotion ? 'blur(0px)' : 'blur(4px)',
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
                duration: shouldReduceMotion ? 0.15 : 0.32,
                delay: shouldReduceMotion ? 0 : 0.12,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
              className="text-3xl sm:text-5xl font-bold tracking-tight text-zinc-900 leading-tight sm:leading-tight mb-3"
            >
              Your AI Panel: ChatGPT, Claude and Gemini in One Conversation
            </motion.h1>

            {/* Secondary Highlight Line */}
            <motion.p
              initial={{
                opacity: shouldReduceMotion ? 1 : 0,
                y: shouldReduceMotion ? 0 : 12,
                filter: shouldReduceMotion ? 'blur(0px)' : 'blur(4px)',
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
                duration: shouldReduceMotion ? 0.15 : 0.32,
                delay: shouldReduceMotion ? 0 : 0.15,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
              className="text-base sm:text-lg font-medium text-zinc-500 mb-4"
            >
              They respond to each other, too.
            </motion.p>

            {/* Subheadline */}
            <motion.p
              initial={{
                opacity: shouldReduceMotion ? 1 : 0,
                y: shouldReduceMotion ? 0 : 12,
                filter: shouldReduceMotion ? 'blur(0px)' : 'blur(4px)',
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
                duration: shouldReduceMotion ? 0.15 : 0.32,
                delay: shouldReduceMotion ? 0 : 0.18,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
              className="text-sm sm:text-base text-zinc-500 font-normal max-w-2xl leading-relaxed mb-8"
            >
              Ask once. Each model sees the same discussion, including what the others have said, so they can challenge ideas, add another perspective, or build on previous answers.
            </motion.p>

            {/* Primary Action Button */}
            <motion.div
              initial={{
                opacity: shouldReduceMotion ? 1 : 0,
                y: shouldReduceMotion ? 0 : 12,
                filter: shouldReduceMotion ? 'blur(0px)' : 'blur(4px)',
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
                duration: shouldReduceMotion ? 0.15 : 0.32,
                delay: shouldReduceMotion ? 0 : 0.24,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
              className="flex flex-col sm:flex-row items-start gap-3"
            >
              <button
                onClick={() => handleOpenAuth('signup')}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-sm shadow-sm transition-all cursor-pointer hover:shadow"
              >
                <span>Start your panel for free</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsDemoModalOpen(true)}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200/80 text-zinc-700 font-medium text-sm shadow-2xs transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-zinc-700 text-zinc-700" />
                <span>Watch demo</span>
              </button>
            </motion.div>
          </div>

          {/* Right Column: Hero Image */}
          <motion.div
            initial={{
              opacity: shouldReduceMotion ? 1 : 0,
              y: shouldReduceMotion ? 0 : 12,
              filter: shouldReduceMotion ? 'blur(0px)' : 'blur(4px)',
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
              duration: shouldReduceMotion ? 0.15 : 0.32,
              delay: shouldReduceMotion ? 0 : 0.04,
              ease: [0.21, 0.47, 0.32, 0.98],
            }}
            className="w-full lg:w-[55%] order-first lg:order-last"
          >
            <img src="/herodraw.svg" alt="" className="w-full h-auto" />
          </motion.div>
        </section>

        {/* Audience / Role Marquee */}
        <motion.div
          {...scrollRevealProps(0.28)}
          className="w-full py-4 sm:py-5"
        >
          <div className="max-w-6xl mx-auto px-6 sm:px-12">
            <RoleMarquee />
          </div>
        </motion.div>

        {/* Section Header */}
        <section className="px-6 sm:px-12 pt-12 pb-8 max-w-6xl mx-auto w-full text-center">
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
        <section id="about" className="px-6 sm:px-12 py-16 max-w-6xl mx-auto w-full flex flex-col lg:flex-row items-center lg:items-start gap-10 lg:gap-16 border-t border-zinc-100 scroll-mt-16">
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

        {/* Product Capabilities */}
        <section
          id="features"
          className="px-6 sm:px-12 py-16 max-w-6xl mx-auto w-full border-t border-zinc-100 scroll-mt-16"
        >
          <motion.div {...scrollRevealProps(0)} className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50/80 border border-blue-100 text-[#4880E6] text-xs font-medium mb-4 shadow-2xs">
              <Sparkles className="w-3 h-3" />
              <span>More than a multi-AI chat</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 leading-tight">
              What Can You Do With Plurilog?
            </h2>
            <p className="mt-3 text-sm sm:text-base text-zinc-500 font-normal leading-relaxed">
              Work with ChatGPT, Claude and Gemini in one shared conversation, then move from answers to actual work: analyse files and images, create and edit documents, generate visuals, and research without breaking the thread.
            </p>
          </motion.div>

          <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Multi-AI */}
            <motion.div
              {...scrollRevealProps(0.04)}
              className="lg:col-span-2 rounded-3xl border border-zinc-200/80 bg-white overflow-hidden shadow-2xs"
            >
              <div className="relative min-h-[210px] sm:min-h-[230px] bg-gradient-to-br from-amber-50 via-white to-blue-50/80 p-6 sm:p-8 overflow-hidden">
                <div className="absolute -top-10 -right-8 w-36 h-36 rounded-full bg-blue-100/50 blur-2xl" />
                <div className="absolute -bottom-14 left-16 w-40 h-40 rounded-full bg-amber-100/60 blur-2xl" />
                <div className="relative max-w-xl mx-auto">
                  <div className="rounded-2xl border border-zinc-200/80 bg-white/90 shadow-sm p-3.5 sm:p-4">
                    <div className="flex items-center gap-2 pb-3 border-b border-zinc-100">
                      <div className="w-2 h-2 rounded-full bg-zinc-300" />
                      <div className="w-2 h-2 rounded-full bg-zinc-300" />
                      <div className="w-2 h-2 rounded-full bg-zinc-300" />
                      <div className="ml-2 h-2.5 w-28 rounded-full bg-zinc-100" />
                    </div>
                    <div className="mt-4 space-y-2.5">
                      <div className="flex items-center gap-3 rounded-xl bg-amber-50/80 border border-amber-100 px-3 py-2.5">
                        <div className="w-7 h-7 rounded-lg bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0">
                          <span className="text-[10px] font-bold">C</span>
                        </div>
                        <div className="space-y-1.5 flex-1">
                          <div className="h-2 w-4/5 rounded-full bg-amber-200/80" />
                          <div className="h-2 w-2/3 rounded-full bg-amber-100" />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-xl bg-blue-50/80 border border-blue-100 px-3 py-2.5 sm:ml-8">
                        <div className="w-7 h-7 rounded-lg bg-blue-100 border border-blue-200/80 flex items-center justify-center text-[#4880E6] shrink-0">
                          <span className="text-[10px] font-bold">G</span>
                        </div>
                        <div className="space-y-1.5 flex-1">
                          <div className="h-2 w-11/12 rounded-full bg-blue-200/80" />
                          <div className="h-2 w-3/5 rounded-full bg-blue-100" />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-xl bg-zinc-50 border border-zinc-200/70 px-3 py-2.5 sm:ml-16">
                        <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center text-white shrink-0">
                          <span className="text-[10px] font-bold">GPT</span>
                        </div>
                        <div className="space-y-1.5 flex-1">
                          <div className="h-2 w-3/4 rounded-full bg-zinc-300" />
                          <div className="h-2 w-1/2 rounded-full bg-zinc-200" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6 sm:p-7">
                <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-4 shadow-2xs">
                  <MessagesSquare className="w-4.5 h-4.5" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-zinc-900">
                  ChatGPT, Claude and Gemini in One Conversation
                </h3>
                <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-2xl">
                  Ask once and let multiple leading AI models respond to you and to each other. They share the discussion context, so one model can challenge, refine or build on what another has already said.
                </p>
              </div>
            </motion.div>

            {/* Create documents */}
            <motion.div
              {...scrollRevealProps(0.08)}
              className="rounded-3xl border border-zinc-200/80 bg-white overflow-hidden shadow-2xs"
            >
              <div className="relative min-h-[210px] sm:min-h-[230px] bg-zinc-50/80 p-6 flex items-center justify-center overflow-hidden">
                <div className="absolute top-6 left-5 w-24 h-24 rounded-full bg-amber-100/50 blur-2xl" />
                <div className="relative w-44 h-36">
                  <div className="absolute inset-x-5 top-1 h-32 rounded-xl border border-zinc-200 bg-white shadow-sm rotate-[-5deg] p-3">
                    <div className="flex justify-between items-center">
                      <div className="h-2.5 w-16 rounded-full bg-zinc-800" />
                      <span className="text-[8px] font-bold text-[#4880E6]">DOCX</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      <div className="h-1.5 rounded-full bg-zinc-200" />
                      <div className="h-1.5 w-5/6 rounded-full bg-zinc-200" />
                      <div className="h-1.5 w-3/4 rounded-full bg-zinc-200" />
                    </div>
                  </div>
                  <div className="absolute inset-x-5 top-3 h-32 rounded-xl border border-blue-100 bg-white shadow-md rotate-[5deg] p-3">
                    <div className="flex justify-between items-center">
                      <div className="h-2.5 w-14 rounded-full bg-zinc-800" />
                      <span className="text-[8px] font-bold text-[#D94726]">PDF</span>
                    </div>
                    <div className="mt-3 h-12 rounded-lg bg-blue-50 border border-blue-100" />
                    <div className="mt-2 space-y-1.5">
                      <div className="h-1.5 rounded-full bg-zinc-200" />
                      <div className="h-1.5 w-2/3 rounded-full bg-zinc-200" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <div className="w-9 h-9 rounded-xl bg-[#D64A2A]/10 border border-[#D64A2A]/20 flex items-center justify-center text-[#D64A2A] mb-4 shadow-2xs">
                  <FileText className="w-4.5 h-4.5" />
                </div>
                <h3 className="text-base font-semibold text-zinc-900">
                  Create Word Documents and PDFs
                </h3>
                <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                  Turn a conversation into a polished downloadable DOCX or PDF with structured text, tables, layouts and images.
                </p>
              </div>
            </motion.div>

            {/* Edit documents */}
            <motion.div
              {...scrollRevealProps(0.12)}
              className="rounded-3xl border border-zinc-200/80 bg-white overflow-hidden shadow-2xs"
            >
              <div className="min-h-[185px] bg-amber-50/50 p-6 flex items-center justify-center">
                <div className="relative w-full max-w-[220px] rounded-2xl border border-zinc-200 bg-white shadow-sm p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-2.5 w-20 rounded-full bg-zinc-800" />
                    <Edit3 className="w-4 h-4 text-[#D94726]" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 rounded-full bg-zinc-200" />
                    <div className="h-2 w-5/6 rounded-full bg-zinc-200" />
                    <div className="relative h-7 rounded-md bg-amber-50 border border-amber-200/80">
                      <div className="absolute left-2 top-2 h-2 w-3/5 rounded-full bg-amber-300" />
                    </div>
                    <div className="h-2 w-3/4 rounded-full bg-zinc-200" />
                  </div>
                </div>
              </div>
              <div className="p-6">
                <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-4 shadow-2xs">
                  <Edit3 className="w-4.5 h-4.5" />
                </div>
                <h3 className="text-base font-semibold text-zinc-900">
                  Edit Existing Documents
                </h3>
                <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                  Upload a Word document or PDF, ask for changes in plain English, and keep refining the result without starting from scratch.
                </p>
              </div>
            </motion.div>

            {/* Images */}
            <motion.div
              {...scrollRevealProps(0.16)}
              className="lg:col-span-2 rounded-3xl border border-zinc-200/80 bg-white overflow-hidden shadow-2xs"
            >
              <div className="relative min-h-[185px] bg-gradient-to-r from-blue-50/80 via-white to-indigo-50/70 p-6 overflow-hidden">
                <div className="absolute -top-12 right-12 w-36 h-36 rounded-full bg-blue-200/40 blur-3xl" />
                <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3 max-w-xl mx-auto">
                  <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-2.5">
                    <div className="aspect-[4/3] rounded-xl bg-gradient-to-br from-zinc-100 to-blue-100 flex items-center justify-center">
                      <ImageIcon className="w-8 h-8 text-zinc-400" />
                    </div>
                    <div className="mt-2 h-2 w-2/3 rounded-full bg-zinc-200" />
                  </div>
                  <div className="w-9 h-9 rounded-full bg-zinc-900 text-white flex items-center justify-center shadow-sm">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="rounded-2xl border border-blue-200 bg-white shadow-sm p-2.5">
                    <div className="aspect-[4/3] rounded-xl bg-gradient-to-br from-[#4880E6]/20 to-cyan-100 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-xl bg-white/80 border border-white shadow-sm flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-[#4880E6]" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="h-2 w-1/2 rounded-full bg-blue-200" />
                      <span className="text-[8px] font-semibold text-[#4880E6]">SVG</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6 sm:p-7">
                <div className="w-9 h-9 rounded-xl bg-[#4880E6]/10 border border-[#4880E6]/20 flex items-center justify-center text-[#4880E6] mb-4 shadow-2xs">
                  <ImageIcon className="w-4.5 h-4.5" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-zinc-900">
                  Generate and Edit Images
                </h3>
                <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-2xl">
                  Create new images or edit existing ones inside the discussion. Preview and download SVG artwork, then let the other AIs inspect the visual and continue working from it.
                </p>
              </div>
            </motion.div>

            {/* Analyse */}
            <motion.div
              {...scrollRevealProps(0.20)}
              className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-2xs"
            >
              <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#4880E6] mb-4 shadow-2xs">
                <Search className="w-4.5 h-4.5" />
              </div>
              <h3 className="text-base font-semibold text-zinc-900">
                Analyse Files and Images Together
              </h3>
              <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                Work with PDFs, Word files, images and text files without repeatedly moving the same material between separate AI apps.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {['PDF', 'DOCX', 'Images', 'Text'].map((label) => (
                  <span
                    key={label}
                    className="px-2.5 py-1 rounded-full bg-zinc-50 border border-zinc-200/80 text-[10px] font-medium text-zinc-500"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </motion.div>

            {/* Research */}
            <motion.div
              {...scrollRevealProps(0.24)}
              className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-2xs"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 mb-4 shadow-2xs">
                <Globe2 className="w-4.5 h-4.5" />
              </div>
              <h3 className="text-base font-semibold text-zinc-900">
                Research and Build on Shared Context
              </h3>
              <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                Search the web when needed, revisit earlier material, compare perspectives and keep the work moving inside one ongoing discussion.
              </p>
              <div className="mt-5 rounded-xl bg-zinc-50 border border-zinc-200/70 p-3">
                <div className="flex items-center gap-2 text-[10px] font-medium text-zinc-500">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  Shared discussion context
                </div>
              </div>
            </motion.div>
          </div>

          <motion.div {...scrollRevealProps(0.28)} className="mt-10 flex flex-col items-center gap-3">
            <button
              onClick={() => handleOpenAuth('signup')}
              className="flex items-center gap-2 px-7 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-sm shadow-sm transition-all cursor-pointer hover:shadow"
            >
              <span>Start your AI panel for free</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-[11px] text-zinc-400">No card required.</p>
          </motion.div>
        </section>

        {/* Pricing Section */}
        <section
          id="pricing"
          className="w-full border-t border-zinc-100 scroll-mt-16"
        >
          <div className="max-w-5xl mx-auto px-6 sm:px-12 py-16">
            <motion.div {...scrollRevealProps(0)}>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 text-center">
                Simple pricing
              </h2>
              <p className="mt-3 max-w-2xl mx-auto text-center text-sm sm:text-base text-zinc-500 leading-relaxed">
                Try Plurilog for free, then upgrade when you&apos;re ready.
              </p>
            </motion.div>

            <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto items-stretch">
              {/* Free Card */}
              <motion.div
                {...scrollRevealProps(0.06)}
                className="rounded-2xl border border-zinc-200/80 bg-white/80 p-6 sm:p-8 flex flex-col justify-between shadow-2xs hover:border-zinc-300 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-zinc-900">Free</h3>
                  </div>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900">$0</span>
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed mb-6">
                    Try Plurilog with one-time starter usage.
                  </p>
                  <ul className="space-y-3 text-xs sm:text-sm text-zinc-600 mb-8">
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>ChatGPT, Claude and Gemini together</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>Shared conversation context</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>Files and images</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>Full panel controls</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>One-time included usage</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>No card required</span>
                    </li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenAuth('signup')}
                  className="w-full py-3 px-4 rounded-xl border border-zinc-200/90 bg-white hover:bg-zinc-50 text-zinc-900 font-medium text-sm transition-colors cursor-pointer shadow-2xs"
                >
                  Start free
                </button>
              </motion.div>

              {/* Plus Card */}
              <motion.div
                {...scrollRevealProps(0.12)}
                className="relative rounded-2xl border-2 border-amber-300 bg-amber-50/40 p-6 sm:p-8 flex flex-col justify-between shadow-sm hover:border-amber-400 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-zinc-900">Plus</h3>
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-medium border border-amber-200/80">
                      Recommended
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mb-2">
                    <span className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900">$19</span>
                    <span className="text-xs sm:text-sm text-zinc-500 font-medium">/ month</span>
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed mb-6">
                    For ongoing use of Plurilog.
                  </p>
                  <ul className="space-y-3 text-xs sm:text-sm text-zinc-700 mb-8">
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span className="font-medium">Everything in Free</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>Monthly usage refreshed every billing cycle</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>ChatGPT, Claude and Gemini available</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>Shared memory, files and retrieval</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="w-4 h-4 rounded-full bg-amber-100 border border-amber-200/80 flex items-center justify-center text-amber-900 shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                      </div>
                      <span>Cancel anytime</span>
                    </li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={handleGetPlus}
                  className="w-full py-3 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-sm transition-all cursor-pointer shadow-sm hover:shadow"
                >
                  Get Plus
                </button>
              </motion.div>
            </div>
          </div>
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
          <PlurilogMark className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
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
        redirectUrl={authRedirectTarget}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

      {/* Demo Walkthrough Video Modal */}
      <DemoVideoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
      />
    </div>
  );
}
