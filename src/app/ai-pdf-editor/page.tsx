import type { Metadata } from 'next';
import { SeoFeaturePage } from '@/components/SeoFeaturePage';

const canonical = 'https://plurilogai.com/ai-pdf-editor';

export const metadata: Metadata = {
  title: 'AI PDF Editor: Edit & Work With PDFs',
  description:
    'Use AI to analyse and edit supported PDF documents in Plurilog. Ask for changes in plain English, keep the PDF in context and continue refining it with multiple AI models.',
  alternates: { canonical },
  openGraph: {
    title: 'AI PDF Editor: Edit & Work With PDFs | Plurilog',
    description: 'Analyse and revise supported PDFs with AI inside one ongoing multi-model conversation.',
    url: canonical,
    siteName: 'Plurilog',
    locale: 'en_US',
    type: 'website',
    images: [{ url: 'https://plurilogai.com/opengraph-image.png', width: 1200, height: 630, alt: 'Plurilog AI PDF editor' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI PDF Editor | Plurilog',
    description: 'Analyse and revise supported PDFs with AI inside one ongoing multi-model conversation.',
    images: ['https://plurilogai.com/twitter-image.png'],
  },
};

export default function AiPdfEditorPage() {
  return (
    <SeoFeaturePage
      eyebrow="PDF workflows"
      title="AI PDF Editor: Edit and Work With PDFs in Plurilog"
      description="Upload a PDF, ask questions about it, request supported edits in plain English and keep the document inside the same ongoing conversation with ChatGPT, Claude and Gemini."
      canonical={canonical}
      sections={[
        {
          heading: 'Analyse a PDF before changing it',
          paragraphs: [
            'A PDF can be part of the discussion instead of a one-off upload. Plurilog creates a searchable representation of supported documents so the AI panel can retrieve relevant information as the conversation develops.',
            'You can ask for a summary, locate information, compare sections, check wording or use the document as source material for a longer piece of work.',
          ],
        },
        {
          heading: 'Request PDF edits in plain English',
          paragraphs: [
            'For supported PDF workflows, you can describe the change you want conversationally rather than editing the file manually. That can include text revisions and other supported document changes, followed by another round of feedback and refinement.',
            'Because the source document remains part of the discussion, you can continue from the previous revision instead of rebuilding the task from scratch.',
          ],
        },
        {
          heading: 'Use more than one AI around the same PDF',
          paragraphs: [
            'The same PDF can support a multi-model discussion. One AI might propose wording, another can critique the change, and the conversation can continue while the source material remains available.',
            'This is useful when the work involves both document editing and judgement: for example, revising a CV, checking a report, comparing interpretations or improving the clarity of a document.',
          ],
        },
        {
          heading: 'PDF editing has practical limits',
          paragraphs: [
            'PDFs are fixed-layout documents, so editing them is inherently more constrained than editing an original Word file. Complex formatting, exact font preservation and very precise positional changes may not always reproduce perfectly.',
            'For heavily designed documents where exact typography or pixel-level layout matters, keeping the editable source file is still the safer workflow. Plurilog is strongest when the requested PDF changes are compatible with the source structure.',
          ],
        },
      ]}
      faqs={[
        {
          question: 'Can Plurilog edit an existing PDF?',
          answer: 'Yes, for supported PDF workflows. You can upload a PDF and request changes in plain English, then continue refining the result in the same discussion.',
        },
        {
          question: 'Can Plurilog analyse a PDF without editing it?',
          answer: 'Yes. You can ask questions, summarise sections, locate information and discuss the contents of supported PDFs with the AI panel.',
        },
        {
          question: 'Will an edited PDF keep every font and layout detail exactly?',
          answer: 'Not always. PDF editing is more constrained than Word-document editing, and complex typography, exact font preservation or precise positioning can vary depending on the source file.',
        },
        {
          question: 'Can multiple AI models work from the same PDF?',
          answer: 'Yes. Relevant document context can remain available to the shared discussion so different participating AI models can analyse or respond to the same source material.',
        },
      ]}
      related={[
        { href: '/ai-document-editor', title: 'AI document editor', description: 'Edit Word documents and PDFs with an ongoing AI discussion.' },
        { href: '/ai-word-document-generator', title: 'Word document generator', description: 'Create a new downloadable DOCX from your conversation.' },
        { href: '/chatgpt-claude-gemini', title: 'Multi-model AI conversation', description: 'See how ChatGPT, Claude and Gemini work in one discussion.' },
      ]}
    />
  );
}
