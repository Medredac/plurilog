import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { articleContent } from './content';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { MotionReveal } from '@/components/MotionReveal';
import { PlurilogMark } from '@/components/PlurilogMark';

const canonical = 'https://plurilogai.com/blog/analyzing-legal-documents-with-ai';
const title = 'Analyzing Legal Documents with AI: Beyond a Single Interpretation';
const description = 'Analyze legal documents with AI in Plurilog. Compare interpretations, examine clauses and turn a shared discussion into clear questions and a usable review.';
const published = '2026-10-23T00:00:00.000Z';
export const metadata: Metadata = {
  title, description,
  alternates: { canonical },
  openGraph: {
    title: title + ' | Plurilog', description, url: canonical, siteName: 'Plurilog',
    locale: 'en_US', type: 'article', publishedTime: published,
    images: [{ url: 'https://plurilogai.com/opengraph-image.png', width: 1200, height: 630, alt: 'Plurilog - Your Own AI Panel' }],
  },
  twitter: { card: 'summary_large_image', title, description, images: ['https://plurilogai.com/twitter-image.png'] },
};

const articleJsonLd = {
  '@context': 'https://schema.org', '@type': 'BlogPosting',
  headline: title, description, image: 'https://plurilogai.com/opengraph-image.png',
  datePublished: published, dateModified: published,
  author: { '@type': 'Organization', name: 'Plurilog', url: 'https://plurilogai.com' },
  publisher: { '@type': 'Organization', name: 'Plurilog', url: 'https://plurilogai.com',
    logo: { '@type': 'ImageObject', url: 'https://plurilogai.com/logo.svg' } },
  mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
};
const breadcrumbJsonLd = {
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://plurilogai.com/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://plurilogai.com/blog' },
    { '@type': 'ListItem', position: 3, name: title, item: canonical },
  ],
};

const markdownComponents: Components = {
  h2: ({ children }) => <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="font-semibold text-zinc-900 text-base pt-2">{children}</h3>,
  strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1.5 text-zinc-600">{children}</ul>,
  blockquote: ({ children }) => <blockquote className="pl-4 border-l-2 border-zinc-900 text-base sm:text-lg font-medium text-zinc-900">{children}</blockquote>,
  a: ({ href, children }) => {
    const className = 'text-zinc-900 underline hover:no-underline font-medium';
    return href?.startsWith('/')
      ? <Link href={href} className={className}>{children}</Link>
      : <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
  },
  table: ({ children }) => <div className="overflow-x-auto rounded-xl border border-zinc-200"><table className="w-full text-left text-sm border-collapse">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-zinc-50 text-zinc-900">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-zinc-100 last:border-b-0">{children}</tr>,
  th: ({ children, style }) => <th scope="col" style={style} className="p-3 border-b border-zinc-200 font-semibold">{children}</th>,
  td: ({ children, style }) => <td style={style} className="p-3 align-top text-zinc-600">{children}</td>,
};
const articleSections = articleContent.split(/\n(?=## )/);

export default function LegalDocumentAnalysisBlogPost() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <SiteHeader />
      <main className="flex-1 bg-tech-grid">
        <div className="max-w-3xl mx-auto w-full px-6 sm:px-8 py-12 sm:py-16">
          <Link href="/blog" className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-700 transition-colors mb-6 cursor-pointer group">
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" /><span>Back to Blog</span>
          </Link>
          <MotionReveal className="mb-8">
            <time dateTime="2026-10-23" className="text-xs font-medium text-zinc-400 block mb-2.5">October 23, 2026</time>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 leading-tight mb-4">{title}</h1>
            <p className="text-xs text-zinc-500 mb-6">Written by the Plurilog team</p>
            <div className="aspect-[16/9] w-full rounded-2xl overflow-hidden border border-zinc-200/80 shadow-2xs bg-zinc-100">
              <video src="/legal-documents-three-readings.mp4"
                autoPlay loop muted playsInline preload="metadata" controls={false}
                disablePictureInPicture disableRemotePlayback controlsList="nodownload nofullscreen noremoteplayback"
                aria-hidden="true" tabIndex={-1} className="w-full h-full object-cover pointer-events-none select-none" />
            </div>
          </MotionReveal>
          <article className="text-sm sm:text-base text-zinc-600 leading-relaxed space-y-8">
            {articleSections.map((section) => (
              <MotionReveal key={section.split('\n')[0]} as="section" className="space-y-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{section}</ReactMarkdown>
              </MotionReveal>
            ))}
            <MotionReveal as="section" className="mt-12 p-8 sm:p-10 rounded-2xl bg-zinc-900 text-white text-center space-y-4 shadow-sm">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Examine your documents with your AI panel</h2>
              <p className="text-sm sm:text-base text-zinc-300 max-w-xl mx-auto leading-relaxed">Explore your documents with multiple AI perspectives in one conversation.</p>
              <div className="pt-2">
                <Link href="/?signup=true" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 font-semibold text-sm transition-colors shadow-xs cursor-pointer">
                  <span>Open your panel</span><ArrowRight className="w-4 h-4" />
                </Link>
              </div>
              <p className="text-xs text-zinc-300">Plus is $4.99/week or $19/month. Both plans include the same benefits. Cancel anytime.</p>
            </MotionReveal>
            <MotionReveal as="section" className="space-y-3">
              <h2 className="text-lg font-bold text-zinc-900">Explore more Plurilog guides</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li><Link href="/blog/chatgpt-claude-gemini-shared-conversation" className="text-zinc-900 underline hover:no-underline">Why we built Plurilog around one shared AI conversation</Link></li>
                <li><Link href="/blog/ai-hallucinations-chatgpt-claude-gemini" className="text-zinc-900 underline hover:no-underline">AI hallucinations: why AI gets things wrong</Link></li>
                <li><Link href="/ai-document-editor" className="text-zinc-900 underline hover:no-underline">Working with documents in Plurilog</Link></li>
              </ul>
            </MotionReveal>
            <MotionReveal as="section" className="space-y-2">
              <p className="text-xs text-zinc-500">By the Plurilog team. Published October 23, 2026.</p>
            </MotionReveal>
          </article>
        </div>
      </main>
      <footer className="px-6 sm:px-12 py-6 border-t border-zinc-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-2"><PlurilogMark className="w-3.5 h-3.5 text-zinc-400 shrink-0" /><span>Plurilog &copy; {new Date().getFullYear()}</span></div>
        <nav aria-label="Footer navigation" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px]">
          <Link href="/#about" className="hover:text-zinc-600 transition-colors">About</Link>
          <Link href="/#pricing" className="hover:text-zinc-600 transition-colors">Pricing</Link>
          <Link href="/#faq" className="hover:text-zinc-600 transition-colors">FAQ</Link>
          <Link href="/blog" className="hover:text-zinc-600 transition-colors font-medium text-zinc-600">Blog</Link>
          <Link href="/privacy" className="hover:text-zinc-600 transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-zinc-600 transition-colors">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
