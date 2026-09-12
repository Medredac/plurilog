import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { MotionReveal } from '@/components/MotionReveal';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Insights, updates, and ideas from Plurilog.',
  robots: {
    index: false,
    follow: true,
  },
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

          <MotionReveal delay={0.08} className="p-8 sm:p-12 rounded-2xl bg-white/80 border border-zinc-200/80 text-center shadow-2xs">
            <p className="text-sm font-medium text-zinc-400">
              Articles coming soon.
            </p>
          </MotionReveal>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="px-6 sm:px-12 py-6 border-t border-zinc-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-md bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-900 text-[10px]">
            <span className="font-semibold text-[9px]">P</span>
          </div>
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
