import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { MotionReveal } from '@/components/MotionReveal';
import { PlurilogMark } from '@/components/PlurilogMark';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Learn how Plurilog collects, uses, and protects your information.',
  alternates: {
    canonical: 'https://plurilogai.com/privacy',
  },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      {/* Navigation Header */}
      <SiteHeader />

      {/* Main Content Column */}
      <main className="flex-1 bg-tech-grid">
        <div className="max-w-3xl mx-auto w-full px-6 sm:px-8 py-12 sm:py-16">
        <MotionReveal className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-2">
            Privacy Policy
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400">
            Last updated: October 2, 2026
          </p>
        </MotionReveal>

        <article className="text-sm sm:text-base text-zinc-600 leading-relaxed space-y-6">
          <MotionReveal delay={0.06}>
            <p>
              Plurilog (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;) operates Plurilog, an app that lets you ask questions to multiple AI models at once and compare their answers. This policy explains what information we collect, how we use it, and the choices you have.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Information We Collect
            </h2>
            <p>
              We collect information you provide when creating an account or using Plurilog, along with limited subscription, usage and technical information needed to operate, secure and improve the service.
            </p>
            <p>
              On our public website, we may also use analytics and advertising measurement technologies. Where consent is required, these technologies remain off unless you choose Accept.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              How We Use Your Information
            </h2>
            <p>
              We use your information to provide and improve Plurilog, manage accounts and subscriptions, process payments, communicate with you, provide support, maintain security, enforce usage limits and measure the performance of our website and marketing.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Who We Share Information With
            </h2>
            <p>
              We use trusted service providers to operate Plurilog, including cloud hosting and database providers, AI model providers, payment processors, email providers, authentication providers, analytics services and advertising measurement services. These providers receive only the information needed to perform their services.
            </p>
            <p>
              We do not sell your personal information to anyone, ever.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              How Long We Keep Your Information
            </h2>
            <p>
              We retain personal information only for as long as reasonably necessary to provide the service, meet our legal obligations and resolve disputes. You can permanently delete your account and associated personal information directly from your account settings. If you have an active Plus subscription, you&apos;ll need to cancel it first.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Your Rights
            </h2>
            <p>
              Depending on where you live, you may have the right to access, correct, delete, or receive a copy of your personal information, and to object to or restrict certain uses of it. To exercise any of these rights, email us at <a href="mailto:plurilogAI@gmail.com" className="text-zinc-900 underline hover:no-underline font-medium">plurilogAI@gmail.com</a>.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              International Data Transfers
            </h2>
            <p>
              Some of our service providers may process information in countries other than the one you live in, which may have different data protection laws.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Security
            </h2>
            <p>
              We take reasonable technical measures to protect your information, including encrypted connections, private storage with per-user access controls, and secure password handling. No system can be guaranteed 100% secure, but we work to protect your information appropriately.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Children&apos;s Privacy
            </h2>
            <p>
              Plurilog is not directed at, and is not intended for use by, anyone under 18 years old. We do not knowingly collect information from children.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Changes to This Policy
            </h2>
            <p>
              We may update this policy from time to time. We&apos;ll update the &ldquo;Last updated&rdquo; date above, and for significant changes, we&apos;ll make reasonable efforts to let you know.
            </p>
          </MotionReveal>

          <MotionReveal as="section" className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Contact Us
            </h2>
            <p>
              Questions about this policy, or want to exercise your data rights? Email us at <a href="mailto:plurilogAI@gmail.com" className="text-zinc-900 underline hover:no-underline font-medium">plurilogAI@gmail.com</a>.
            </p>
          </MotionReveal>
        </article>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="px-6 sm:px-12 py-6 border-t border-zinc-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <PlurilogMark className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span>Plurilog &copy; {new Date().getFullYear()}</span>
        </div>

        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px]"
        >
          <Link href="/#about" className="hover:text-zinc-600 transition-colors">About</Link>
          <Link href="/#pricing" className="hover:text-zinc-600 transition-colors">Pricing</Link>
          <Link href="/#faq" className="hover:text-zinc-600 transition-colors">FAQ</Link>
          <Link href="/blog" className="hover:text-zinc-600 transition-colors">Blog</Link>
          <Link href="/privacy" className="hover:text-zinc-600 transition-colors font-medium text-zinc-600">Privacy</Link>
          <Link href="/terms" className="hover:text-zinc-600 transition-colors">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
