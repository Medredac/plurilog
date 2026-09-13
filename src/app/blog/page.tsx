import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { MotionReveal } from '@/components/MotionReveal';
import { PlurilogMark } from '@/components/PlurilogMark';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Insights, updates, and ideas from Plurilog.',
  alternates: {
    canonical: 'https://plurilogai.com/blog',
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
              Blog
            </h1>
            <p className="text-sm sm:text-base text-zinc-500">
              Insights, updates, and ideas from Plurilog.
            </p>
          </MotionReveal>

          <MotionReveal delay={0.08}>
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
