import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Privacy Policy · Plurilog',
  description: 'Learn how Plurilog collects, uses, and protects your information.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      {/* Navigation Header */}
      <SiteHeader />

      {/* Main Content Column */}
      <main className="flex-1 bg-tech-grid">
        <div className="max-w-3xl mx-auto w-full px-6 sm:px-8 py-12 sm:py-16">
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-2">
            Privacy Policy
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400">
            Last updated: August 30, 2026
          </p>
        </div>

        <article className="text-sm sm:text-base text-zinc-600 leading-relaxed space-y-6">
          <p>
            Plurilog (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;) operates Plurilog, an app that lets you ask questions to multiple AI models at once and compare their answers. This policy explains what information we collect, how we use it, and the choices you have.
          </p>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Information We Collect
            </h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="font-medium text-zinc-800">Account information</strong>: your email address, a password (stored securely, never in plain text), and an optional display name. If you sign in with Google, we receive your name, email, and profile photo from Google.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Your content</strong>: the messages you send and the AI responses you receive, so you can revisit past discussions.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Uploaded images</strong>: photos or files you attach to a message.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Payment information</strong>: if you subscribe to Plurilog Plus, our payment processor (Stripe) handles your card details directly. We never see or store your full card number.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Basic technical data</strong>: standard server logs (like IP address and timestamps) generated automatically by our hosting provider for security and troubleshooting purposes.
              </li>
            </ul>
            <p>
              We do not use any advertising trackers, analytics pixels, or third-party marketing cookies. The only cookies we use are strictly necessary ones that keep you signed in.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              How We Use Your Information
            </h2>
            <p>
              We use your information to: provide and operate the service, including sending your messages to AI providers to generate responses; save your discussion history so you can return to it; process payments and manage your subscription; send you account-related emails (like password resets); enforce usage limits; and respond if you contact us for support.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Who We Share Information With
            </h2>
            <p>
              To provide Plurilog, we work with a small number of service providers, who only receive what they need to do their job:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="font-medium text-zinc-800">Supabase</strong> &mdash; our database and file storage provider.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Vercel</strong> &mdash; hosts and runs our application.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">OpenRouter</strong> &mdash; routes your messages to the underlying AI models (Google&apos;s Gemini, Anthropic&apos;s Claude, and OpenAI&apos;s ChatGPT) to generate responses. Your message content is sent to these AI providers for the purpose of generating a reply.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Stripe</strong> &mdash; processes payments for Plurilog Plus.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Resend</strong> &mdash; delivers transactional emails (like password resets).
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Google</strong> &mdash; if you choose to sign in with Google.
              </li>
            </ul>
            <p>
              We do not sell your personal information to anyone, ever.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              How Long We Keep Your Information
            </h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="font-medium text-zinc-800">Discussion text</strong> is kept for as long as your account is active, so you can revisit past conversations. You can permanently delete any individual discussion at any time from within the app &mdash; this happens immediately.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Uploaded images</strong> are automatically and permanently deleted within roughly 48&ndash;72 hours, regardless of whether you delete the discussion itself.
              </li>
              <li>
                <strong className="font-medium text-zinc-800">Account deletion</strong>: if you&apos;d like your entire account and all associated data deleted, email us at <a href="mailto:plurilog@gmail.com" className="text-zinc-900 underline hover:no-underline font-medium">plurilog@gmail.com</a> and we&apos;ll process your request within 30 days.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Your Rights
            </h2>
            <p>
              Depending on where you live, you may have the right to access, correct, delete, or receive a copy of your personal information, and to object to or restrict certain uses of it. To exercise any of these rights, email us at <a href="mailto:plurilog@gmail.com" className="text-zinc-900 underline hover:no-underline font-medium">plurilog@gmail.com</a>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              International Data Transfers
            </h2>
            <p>
              Some of our service providers are based in the United States. This means your information may be processed in a country other than the one you live in, which may have different data protection laws.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Security
            </h2>
            <p>
              We take reasonable technical measures to protect your information, including encrypted connections, private storage with per-user access controls, and secure password handling. No system can be guaranteed 100% secure, but we work to protect your information appropriately.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Children&apos;s Privacy
            </h2>
            <p>
              Plurilog is not directed at, and is not intended for use by, anyone under 18 years old. We do not knowingly collect information from children.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Changes to This Policy
            </h2>
            <p>
              We may update this policy from time to time. We&apos;ll update the &ldquo;Last updated&rdquo; date above, and for significant changes, we&apos;ll make reasonable efforts to let you know.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
              Contact Us
            </h2>
            <p>
              Questions about this policy, or want to exercise your data rights? Email us at <a href="mailto:plurilog@gmail.com" className="text-zinc-900 underline hover:no-underline font-medium">plurilog@gmail.com</a>.
            </p>
          </section>
        </article>
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
          <Link href="/privacy" className="hover:text-zinc-600 transition-colors font-medium text-zinc-600">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-zinc-600 transition-colors">Terms of Service</Link>
        </div>
      </footer>
    </div>
  );
}
