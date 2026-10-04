import type { Metadata } from 'next';
import { SeoFeaturePage } from '@/components/SeoFeaturePage';

const canonical = 'https://plurilogai.com/compare-ai-models';

export const metadata: Metadata = {
  title: 'Compare AI Models in One Shared Discussion',
  description:
    'Compare AI models with ChatGPT, Claude and Gemini in one shared discussion, where the models can read, respond to and challenge each other.',
  alternates: { canonical },
  openGraph: {
    title: 'Compare AI Models in One Shared Discussion | Plurilog',
    description:
      'Compare ChatGPT, Claude and Gemini inside one shared discussion instead of copying prompts between separate tabs.',
    url: canonical,
    siteName: 'Plurilog',
    locale: 'en_US',
    type: 'website',
    images: [{ url: 'https://plurilogai.com/opengraph-image.png', width: 1200, height: 630, alt: 'Compare AI models in Plurilog' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Compare AI Models in One Shared Discussion | Plurilog',
    description:
      'Compare ChatGPT, Claude and Gemini in one discussion where the models can respond to each other.',
    images: ['https://plurilogai.com/twitter-image.png'],
  },
};

export default function CompareAiModelsPage() {
  return (
    <SeoFeaturePage
      eyebrow="AI model comparison"
      title="Compare AI Models in One Shared Discussion"
      description="Plurilog lets you compare ChatGPT, Claude and Gemini without copying the same prompt between tabs. The models share one discussion, so later responses can react to what another AI has already said."
      canonical={canonical}
      sections={[
        {
          heading: 'Compare more than isolated outputs',
          paragraphs: [
            'Traditional AI comparison often means asking several models the same question in separate tabs and reading the answers side by side. That can show differences, but each model is still working in isolation.',
            'Plurilog keeps the comparison inside one shared discussion. Later participating models can see earlier contributions from the current conversation and respond to them, so the comparison can develop instead of stopping at three disconnected answers.',
          ],
        },
        {
          heading: 'How cross-model comparison works',
          paragraphs: [
            'Ask a question once, choose which AI seats participate and set the order in which they respond. ChatGPT, Claude and Gemini can then contribute to the same ongoing conversation.',
            'A later model can agree with an earlier answer, challenge a claim, identify a missing detail, explain a different approach or build on useful context that is already in the discussion.',
          ],
        },
        {
          heading: 'Why compare different AI models?',
          paragraphs: [
            'Different models can prioritise different details, make different assumptions and take different approaches to the same task. Seeing those differences in one place can make weak reasoning, omissions and trade-offs easier to notice.',
            'This can be useful for research, writing, planning, document work, brainstorming and other tasks where a second or third perspective is more useful than repeatedly asking one model to try again.',
          ],
        },
        {
          heading: 'Comparison is not verification',
          paragraphs: [
            'Multiple AI models can still make the same mistake or rely on the same weak assumption. Agreement between models should not be treated as proof that an answer is correct.',
            'For important factual, legal, medical, financial or other high-stakes decisions, primary sources and qualified professional advice should still take priority over AI agreement.',
          ],
        },
      ]}
      faqs={[
        {
          question: 'Can I compare ChatGPT, Claude and Gemini together?',
          answer: 'Yes. Plurilog lets supported models from OpenAI, Anthropic and Google participate in the same shared discussion, subject to your plan and usage limits.',
        },
        {
          question: 'Do the AI models respond to each other?',
          answer: 'Yes. When multiple AI seats participate, later responses can receive earlier contributions from the shared discussion and respond to what another model has already said.',
        },
        {
          question: 'Is Plurilog just a side-by-side AI comparison tool?',
          answer: 'No. You can compare AI models, but the core experience is one evolving discussion where the models can react to earlier answers rather than producing only isolated outputs.',
        },
        {
          question: 'Does Plurilog decide which AI model is best?',
          answer: 'No. Plurilog gives you multiple model perspectives inside the same conversation. Which answer or approach is most useful depends on the task, and important facts should still be checked against reliable evidence.',
        },
      ]}
      related={[
        { href: '/ai-debate', title: 'AI debate', description: 'Let multiple AI models challenge and respond to each other.' },
        { href: '/chatgpt-claude-gemini', title: 'ChatGPT, Claude & Gemini', description: 'See how the three models work together in one conversation.' },
        { href: '/ai-document-editor', title: 'AI document editor', description: 'Revise Word documents and PDFs with multiple AI perspectives.' },
      ]}
    />
  );
}
