import type { Metadata } from 'next';
import { SeoFeaturePage } from '@/components/SeoFeaturePage';

const canonical = 'https://plurilogai.com/chatgpt-claude-gemini';

export const metadata: Metadata = {
  title: 'ChatGPT, Claude & Gemini in One Conversation',
  description:
    'Use ChatGPT, Claude and Gemini in one shared conversation. Compare answers, keep shared context, work with files and let later models respond to earlier AI answers.',
  alternates: { canonical },
  openGraph: {
    title: 'ChatGPT, Claude & Gemini in One Conversation | Plurilog',
    description:
      'Use ChatGPT, Claude and Gemini in one shared conversation with shared context, files and cross-model responses.',
    url: canonical,
    siteName: 'Plurilog',
    locale: 'en_US',
    type: 'website',
    images: [{ url: 'https://plurilogai.com/opengraph-image.png', width: 1200, height: 630, alt: 'Plurilog multi-AI conversation' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ChatGPT, Claude & Gemini in One Conversation | Plurilog',
    description: 'Use ChatGPT, Claude and Gemini in one shared conversation with shared context and files.',
    images: ['https://plurilogai.com/twitter-image.png'],
  },
};

export default function ChatGPTClaudeGeminiPage() {
  return (
    <SeoFeaturePage
      eyebrow="Multi-model AI"
      title="ChatGPT, Claude and Gemini in One Conversation"
      description="Plurilog puts models from OpenAI, Anthropic and Google into the same ongoing discussion, so you can ask once, compare different perspectives and let later AI responses build on what has already been said."
      canonical={canonical}
      sections={[
        {
          heading: 'One prompt, one shared discussion',
          paragraphs: [
            'Using several AI models normally means opening several tabs, repeating the same prompt and manually carrying useful context from one conversation to another. Plurilog keeps that work in a single discussion.',
            'You choose which AI seats participate and the order in which they respond. The discussion stays intact when you change the panel, so switching models does not require starting over.',
          ],
        },
        {
          heading: 'The models can respond to earlier answers',
          paragraphs: [
            'Plurilog is not simply three isolated answers displayed side by side. Later participating models can see earlier contributions from the current discussion and respond to them.',
            'That makes it possible for one model to agree, disagree, identify something another model missed, add context or approach the same problem differently. The exchange is still model-generated reasoning, not independent verification, but disagreements can make assumptions and weak points easier to notice.',
          ],
        },
        {
          heading: 'Shared files, images and context',
          paragraphs: [
            'Documents and images can remain part of the same ongoing discussion. You can ask one model to analyse a file, another to challenge the interpretation, and then continue working from the same source material without moving everything into a new chat.',
            'Plurilog supports PDF and Word-document workflows, image analysis, supported image generation and editing, web search when current information is needed, and voice dictation for prompts.',
          ],
        },
        {
          heading: 'Why use multiple AI models?',
          paragraphs: [
            'Different models can prioritise different details, make different mistakes and take different approaches to the same task. Seeing those differences in one place can be useful for research, writing, planning, document work and decisions where you want more than a single generated answer.',
            'Using multiple models does not guarantee correctness. For important factual, legal, medical, financial or other high-stakes decisions, primary sources and qualified professional advice should still take priority over AI agreement.',
          ],
        },
      ]}
      faqs={[
        {
          question: 'Can ChatGPT, Claude and Gemini see each other’s answers in Plurilog?',
          answer: 'Yes. When multiple AI seats participate, later responses can receive earlier contributions from the shared discussion, allowing them to respond to what another model has already said.',
        },
        {
          question: 'Do I need separate ChatGPT, Claude and Gemini subscriptions?',
          answer: 'No. Plurilog provides access to supported models from OpenAI, Anthropic and Google through its own service, subject to your Plurilog plan and usage limits.',
        },
        {
          question: 'Can I choose which AI models respond?',
          answer: 'Yes. You can turn individual AI seats on or off and change the response order without abandoning the existing discussion.',
        },
        {
          question: 'Does agreement between three AIs mean the answer is correct?',
          answer: 'No. Multiple models can share the same mistaken assumption or source. Comparing them can expose disagreements and blind spots, but important facts should still be checked against reliable evidence.',
        },
      ]}
      related={[
        { href: '/ai-pdf-editor', title: 'AI PDF editor', description: 'Analyse and revise supported PDF documents.' },
        { href: '/ai-word-document-generator', title: 'Word document generator', description: 'Create downloadable DOCX documents from a discussion.' },
        { href: '/ai-document-editor', title: 'AI document editor', description: 'Revise Word documents and PDFs with natural-language instructions.' },
      ]}
    />
  );
}
