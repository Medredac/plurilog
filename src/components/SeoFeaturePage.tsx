import React from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { PlurilogMark } from '@/components/PlurilogMark';
import { MotionReveal } from '@/components/MotionReveal';

type FeatureSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

type FeatureFaq = {
  question: string;
  answer: string;
};

type RelatedLink = {
  href: string;
  title: string;
  description: string;
};

interface SeoFeaturePageProps {
  eyebrow: string;
  title: string;
  description: string;
  canonical: string;
  sections: FeatureSection[];
  faqs: FeatureFaq[];
  related: RelatedLink[];
}

export function SeoFeaturePage({
  eyebrow,
  title,
  description,
  canonical,
  sections,
  faqs,
  related,
}: SeoFeaturePageProps) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': canonical,
        url: canonical,
        name: title,
        description,
        isPartOf: {
          '@id': 'https://plurilogai.com/#website',
        },
        about: {
          '@id': 'https://plurilogai.com/#app',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Plurilog',
            item: 'https://plurilogai.com/',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: title,
            item: canonical,
          },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.answer,
          },
        })),
      },
    ],
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <main className="flex-1 bg-tech-grid">
        <div className="max-w-4xl mx-auto px-6 sm:px-8 py-12 sm:py-16">
          <MotionReveal>
            <Link
              href="/#features"
              className="text-xs font-medium text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              Plurilog features
            </Link>
          </MotionReveal>

          <MotionReveal delay={0.05} className="mt-6 max-w-3xl">
            <header>
            <p className="text-xs sm:text-sm font-medium text-[#4880E6] mb-3">
              {eyebrow}
            </p>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-zinc-900 leading-tight">
              {title}
            </h1>
            <p className="mt-5 text-base sm:text-lg text-zinc-500 leading-relaxed">
              {description}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/?signup=true"
                className="inline-flex items-center px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium transition-colors shadow-sm"
              >
                Try Plurilog free
              </Link>
              <Link
                href="/#pricing"
                className="inline-flex items-center px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-700 text-sm font-medium transition-colors"
              >
                View pricing
              </Link>
            </div>
            </header>
          </MotionReveal>

          <article className="mt-14 space-y-12">
            {sections.map((section, index) => (
              <MotionReveal
                key={section.heading}
                as="section"
                delay={Math.min(0.04 + index * 0.03, 0.13)}
                className="max-w-3xl"
              >
                <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
                  {section.heading}
                </h2>
                <div className="mt-4 space-y-4 text-sm sm:text-base text-zinc-600 leading-relaxed">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.bullets && (
                    <ul className="list-disc pl-5 space-y-2">
                      {section.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </MotionReveal>
            ))}
          </article>

          <MotionReveal as="section" delay={0.08} className="mt-14 border-t border-zinc-100 pt-12">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
              Related Plurilog features
            </h2>
            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              {related.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-2xl border border-zinc-200/90 bg-white p-5 hover:border-zinc-300 hover:shadow-sm transition-all"
                >
                  <h3 className="text-sm font-semibold text-zinc-900">{item.title}</h3>
                  <p className="mt-2 text-xs text-zinc-500 leading-relaxed">{item.description}</p>
                </Link>
              ))}
            </div>
          </MotionReveal>

          <MotionReveal as="section" delay={0.1} className="mt-14 border-t border-zinc-100 pt-12">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
              Frequently asked questions
            </h2>
            <div className="mt-5 divide-y divide-zinc-100 border-y border-zinc-100">
              {faqs.map((item) => (
                <div key={item.question} className="py-5">
                  <h3 className="text-sm sm:text-base font-semibold text-zinc-900">
                    {item.question}
                  </h3>
                  <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </MotionReveal>
        </div>
      </main>

      <footer className="px-6 sm:px-12 py-6 border-t border-zinc-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <PlurilogMark className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span>Plurilog © {new Date().getFullYear()}</span>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <Link href="/blog" className="hover:text-zinc-600 transition-colors">Blog</Link>
          <Link href="/privacy" className="hover:text-zinc-600 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-zinc-600 transition-colors">Terms of Service</Link>
        </div>
      </footer>
    </div>
  );
}
