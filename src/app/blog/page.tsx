import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { MotionReveal } from '@/components/MotionReveal';
import { PlurilogMark } from '@/components/PlurilogMark';

export const metadata: Metadata = {
  title: 'AI Guides: ChatGPT, Claude, Gemini & Multi-Model AI',
  description: 'Guides to ChatGPT, Claude, Gemini, multi-model AI, AI hallucinations, image generation and shared AI workflows from Plurilog.',
  alternates: {
    canonical: 'https://plurilogai.com/blog',
  },
  openGraph: {
    title: 'AI Guides: ChatGPT, Claude, Gemini & Multi-Model AI | Plurilog',
    description: 'Guides to ChatGPT, Claude, Gemini, multi-model AI, AI hallucinations, image generation and shared AI workflows from Plurilog.',
    url: 'https://plurilogai.com/blog',
    siteName: 'Plurilog',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: 'https://plurilogai.com/opengraph-image.png',
        width: 1200,
        height: 630,
        alt: 'Plurilog - Your Own AI Panel',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blog | Plurilog',
    description: 'Guides to ChatGPT, Claude, Gemini, multi-model AI, AI hallucinations, image generation and shared AI workflows from Plurilog.',
    images: ['https://plurilogai.com/twitter-image.png'],
  },
};

export default function BlogPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      {/* Navigation Header */}
      <SiteHeader />

      {/* Main Content Column */}
      <main className="flex-1 bg-tech-grid">
        <div className="max-w-3xl mx-auto w-full px-6 sm:px-8 py-12 sm:py-16">
          <MotionReveal className="mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-2">
              AI Guides & Research
            </h1>
            <p className="text-sm sm:text-base text-zinc-500">
              Guides to ChatGPT, Claude, Gemini, multi-model AI, AI hallucinations, image generation and shared AI workflows from Plurilog.
            </p>
          </MotionReveal>

          <nav
            aria-label="Plurilog feature guides"
            className="mb-10 flex flex-wrap gap-2"
          >
            <Link href="/chatgpt-claude-gemini" className="px-3 py-1.5 rounded-full border border-zinc-200 bg-white text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 transition-colors">
              ChatGPT + Claude + Gemini
            </Link>
            <Link href="/ai-pdf-editor" className="px-3 py-1.5 rounded-full border border-zinc-200 bg-white text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 transition-colors">
              AI PDF editor
            </Link>
            <Link href="/ai-word-document-generator" className="px-3 py-1.5 rounded-full border border-zinc-200 bg-white text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 transition-colors">
              Word document generator
            </Link>
            <Link href="/ai-document-editor" className="px-3 py-1.5 rounded-full border border-zinc-200 bg-white text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 transition-colors">
              AI document editor
            </Link>
          </nav>

          <div className="space-y-8">
            <MotionReveal delay={0.04}>
              <Link
                href="/blog/chatgpt-gemini-image-generation-editing"
                className="group block rounded-2xl bg-white border border-zinc-200/80 overflow-hidden shadow-2xs hover:shadow-md hover:border-zinc-300 transition-all cursor-pointer"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br from-amber-50 via-white to-blue-50 border-b border-zinc-100">
                  <div className="absolute inset-0 bg-tech-grid opacity-60" />
                  <div className="relative h-full p-6 sm:p-8 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex rounded-full border border-zinc-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium text-zinc-600 shadow-2xs">
                        Shared visual context
                      </span>
                      <PlurilogMark className="w-6 h-6 text-zinc-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-3 text-[11px] font-medium">
                        <span className="rounded-lg bg-zinc-900 text-white px-2.5 py-1.5">ChatGPT</span>
                        <span className="text-zinc-300">+</span>
                        <span className="rounded-lg border border-zinc-200 bg-white text-zinc-700 px-2.5 py-1.5">Gemini</span>
                      </div>
                      <p className="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-900 leading-tight">
                        Generate. Compare. Edit. Keep the context.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-6 sm:p-7">
                  <time className="text-xs font-medium text-zinc-400 block mb-2">
                    September 20, 2026
                  </time>
                  <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight mb-2.5 group-hover:text-zinc-700 transition-colors">
                    ChatGPT and Gemini Image Generation in One Shared Conversation
                  </h2>
                  <p className="text-sm text-zinc-500 leading-relaxed line-clamp-3">
                    Generate, compare and edit AI images with ChatGPT and Gemini while multiple AI models share the same visual context inside one ongoing discussion.
                  </p>
                </div>
              </Link>
            </MotionReveal>

            <MotionReveal delay={0.08}>
              <Link
                href="/blog/chatgpt-claude-gemini-shared-conversation"
                className="group block rounded-2xl bg-white border border-zinc-200/80 overflow-hidden shadow-2xs hover:shadow-md hover:border-zinc-300 transition-all cursor-pointer"
              >
                <div className="aspect-[16/9] w-full overflow-hidden bg-zinc-100 border-b border-zinc-100">
                  <img
                    src="/blog/why-we-built-plurilog-shared-ai-conversation.png"
                    alt="Plurilog shared AI conversation with ChatGPT, Claude and Gemini"
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300 ease-out"
                  />
                </div>
                <div className="p-6 sm:p-7">
                  <time className="text-xs font-medium text-zinc-400 block mb-2">
                    September 17, 2026
                  </time>
                  <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight mb-2.5 group-hover:text-zinc-700 transition-colors">
                    Why We Built Plurilog Around One Shared AI Conversation
                  </h2>
                  <p className="text-sm text-zinc-500 leading-relaxed line-clamp-3">
                    ChatGPT, Claude and Gemini are all useful. The problem begins when the same piece of work is spread across separate conversations. Here is why we built Plurilog around one shared discussion instead.
                  </p>
                </div>
              </Link>
            </MotionReveal>

            <MotionReveal delay={0.14}>
              <Link
                href="/blog/chatgpt-vs-claude-vs-gemini"
                className="group block rounded-2xl bg-white border border-zinc-200/80 overflow-hidden shadow-2xs hover:shadow-md hover:border-zinc-300 transition-all cursor-pointer"
              >
                <div className="aspect-[16/9] w-full overflow-hidden bg-zinc-100 border-b border-zinc-100">
                  <img
                    src="/blog/chatgpt-vs-claude-vs-gemini-thumbnail.png"
                    alt="Comparison of ChatGPT, Claude and Gemini AI models"
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300 ease-out"
                  />
                </div>
                <div className="p-6 sm:p-7">
                  <time className="text-xs font-medium text-zinc-400 block mb-2">
                    September 13, 2026
                  </time>
                  <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight mb-2.5 group-hover:text-zinc-700 transition-colors">
                    ChatGPT vs Claude vs Gemini: Which AI Should You Use?
                  </h2>
                  <p className="text-sm text-zinc-500 leading-relaxed line-clamp-3">
                    ChatGPT, Claude and Gemini can give surprisingly different answers to the same question. Here’s how they differ, why there may not be one “best” AI, and when using multiple models makes more sense.
                  </p>
                </div>
              </Link>
            </MotionReveal>

            <MotionReveal delay={0.2}>
              <Link
                href="/blog/ai-hallucinations-chatgpt-claude-gemini"
                className="group block rounded-2xl bg-white border border-zinc-200/80 overflow-hidden shadow-2xs hover:shadow-md hover:border-zinc-300 transition-all cursor-pointer"
              >
                <div className="aspect-[16/9] w-full overflow-hidden bg-zinc-100 border-b border-zinc-100">
                  <img
                    src="/blog/ai-hallucinations-thumbnail.png"
                    alt="AI models cross-checking answers to identify an incorrect response"
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300 ease-out"
                  />
                </div>
                <div className="p-6 sm:p-7">
                  <time className="text-xs font-medium text-zinc-400 block mb-2">
                    September 12, 2026
                  </time>
                  <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight mb-2.5 group-hover:text-zinc-700 transition-colors">
                    AI Hallucinations: Why AI Gets Things Wrong
                  </h2>
                  <p className="text-sm text-zinc-500 leading-relaxed line-clamp-3">
                    ChatGPT, Claude and Gemini can produce answers that sound completely convincing and are still wrong. Here’s why AI hallucinations happen, how to spot them, and how comparing multiple AI models can help.
                  </p>
                </div>
              </Link>
            </MotionReveal>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="px-6 sm:px-12 py-6 border-t border-zinc-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <PlurilogMark className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span>Plurilog &copy; {new Date().getFullYear()}</span>
        </div>

        <div className="flex items-center gap-4 text-[11px]">
          <Link href="/privacy" className="hover:text-zinc-600 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-zinc-600 transition-colors">Terms of Service</Link>
        </div>
      </footer>
    </div>
  );
}
