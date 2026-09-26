import type { Metadata } from 'next';
import { SeoFeaturePage } from '@/components/SeoFeaturePage';

const canonical = 'https://plurilogai.com/ai-word-document-generator';

export const metadata: Metadata = {
  title: 'AI Word Document Generator: Create DOCX Files',
  description:
    'Create downloadable Word documents with AI in Plurilog. Develop the content with ChatGPT, Claude and Gemini, then generate and refine a structured DOCX file.',
  alternates: { canonical },
  openGraph: {
    title: 'AI Word Document Generator: Create DOCX Files | Plurilog',
    description: 'Create and refine downloadable Word documents from an ongoing multi-model AI conversation.',
    url: canonical,
    siteName: 'Plurilog',
    locale: 'en_US',
    type: 'website',
    images: [{ url: 'https://plurilogai.com/opengraph-image.png', width: 1200, height: 630, alt: 'Plurilog AI Word document generator' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Word Document Generator | Plurilog',
    description: 'Create and refine downloadable Word documents from an ongoing multi-model AI conversation.',
    images: ['https://plurilogai.com/twitter-image.png'],
  },
};

export default function AiWordDocumentGeneratorPage() {
  return (
    <SeoFeaturePage
      eyebrow="Document creation"
      title="AI Word Document Generator: Create DOCX Files With Plurilog"
      description="Develop the content with ChatGPT, Claude and Gemini, then turn the discussion into a downloadable Word document without moving the work into a separate AI chat."
      canonical={canonical}
      sections={[
        {
          heading: 'Go from conversation to a real Word document',
          paragraphs: [
            'Plurilog can turn work developed in the discussion into a downloadable DOCX file. Instead of copying AI output into Word and rebuilding the structure manually, you can ask for the document itself.',
            'The document can include structured headings, paragraphs, lists, tables and supported images where they are useful to the requested output.',
          ],
        },
        {
          heading: 'Use the AI panel before creating the file',
          paragraphs: [
            'Document creation does not have to begin with a single model producing a finished draft. You can first use the shared panel to brainstorm, compare approaches, revise wording or identify missing information.',
            'Once the content is where you want it, the conversation can move into document creation while retaining the context that led to the final draft.',
          ],
        },
        {
          heading: 'Refine the document through follow-up instructions',
          paragraphs: [
            'After a Word document has been created, you can continue the discussion and ask for supported changes rather than beginning again. That makes multi-step work more natural: draft, inspect, revise and produce an updated file.',
            'This can be useful for reports, letters, CVs, summaries, proposals, teaching materials and other structured documents where both the content and the final file matter.',
          ],
        },
        {
          heading: 'What Plurilog does not currently create',
          paragraphs: [
            'Plurilog currently supports downloadable Word-document and PDF workflows, but spreadsheet and presentation generation or editing are not part of the current product.',
            'The aim is to keep advertised capabilities aligned with what the application can actually produce today rather than promising file formats that are not yet implemented.',
          ],
        },
      ]}
      faqs={[
        {
          question: 'Can Plurilog create a real .docx file?',
          answer: 'Yes. Plurilog can create downloadable Word documents from the content and instructions developed in a discussion.',
        },
        {
          question: 'Can a Word document include tables and images?',
          answer: 'Supported Word-document workflows can include structured text, tables, layouts and images when they are appropriate to the requested document.',
        },
        {
          question: 'Can I edit the Word document after it is created?',
          answer: 'Yes. You can continue the discussion and request supported revisions to an existing Word document instead of starting the document again.',
        },
        {
          question: 'Can Plurilog create Excel or PowerPoint files?',
          answer: 'Not currently. Spreadsheet and presentation creation or editing are not part of the current Plurilog feature set.',
        },
      ]}
      related={[
        { href: '/ai-document-editor', title: 'AI document editor', description: 'Continue by revising an existing Word document or PDF.' },
        { href: '/ai-pdf-editor', title: 'AI PDF editor', description: 'Analyse and revise supported PDFs.' },
        { href: '/chatgpt-claude-gemini', title: 'Multi-model AI conversation', description: 'Use ChatGPT, Claude and Gemini in one shared discussion.' },
      ]}
    />
  );
}
