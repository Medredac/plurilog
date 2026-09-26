import type { Metadata } from 'next';
import { SeoFeaturePage } from '@/components/SeoFeaturePage';

const canonical = 'https://plurilogai.com/ai-document-editor';

export const metadata: Metadata = {
  title: 'AI Document Editor for Word & PDF Files',
  description:
    'Edit supported Word documents and PDFs with AI in Plurilog. Upload a file, request changes in plain English and refine the document in one shared multi-model conversation.',
  alternates: { canonical },
  openGraph: {
    title: 'AI Document Editor for Word & PDF Files | Plurilog',
    description: 'Upload a Word document or PDF, request AI edits in plain English and keep refining it in one discussion.',
    url: canonical,
    siteName: 'Plurilog',
    locale: 'en_US',
    type: 'website',
    images: [{ url: 'https://plurilogai.com/opengraph-image.png', width: 1200, height: 630, alt: 'Plurilog AI document editor' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Document Editor for Word & PDF Files | Plurilog',
    description: 'Upload a Word document or PDF, request AI edits in plain English and keep refining it in one discussion.',
    images: ['https://plurilogai.com/twitter-image.png'],
  },
};

export default function AiDocumentEditorPage() {
  return (
    <SeoFeaturePage
      eyebrow="Document editing"
      title="AI Document Editor for Word and PDF Files"
      description="Upload an existing document, describe the changes you want in plain English and keep revising it inside the same ongoing conversation with multiple AI models."
      canonical={canonical}
      sections={[
        {
          heading: 'Edit the document you already have',
          paragraphs: [
            'Many AI workflows stop at advice: the model tells you what to change and you make the edits yourself. Plurilog supports document workflows where the existing file can remain the object you are working on.',
            'You can upload a supported Word document or PDF, discuss what needs changing and request a revised file without manually recreating the document from the generated text.',
          ],
        },
        {
          heading: 'Make revisions conversationally',
          paragraphs: [
            'Editing can happen through normal follow-up instructions. You can ask to rewrite a section, adjust wording, change the level of detail, add material or make another supported revision while the earlier conversation remains available.',
            'That continuity matters for documents that take several rounds to finish because the reasoning, source material and previous decisions do not have to be re-explained every time.',
          ],
        },
        {
          heading: 'Let different models contribute to the same job',
          paragraphs: [
            'The document can sit inside a broader multi-model discussion. One model can suggest a change, another can critique the wording or notice an omission, and the next revision can use that feedback.',
            'This does not make every edit automatically correct, but it makes it easier to use different model perspectives without fragmenting the work across unrelated chats.',
          ],
        },
        {
          heading: 'Word and PDF editing are not identical',
          paragraphs: [
            'DOCX files are editable document formats and generally offer more flexibility for layout-aware revisions. PDFs are fixed-layout files, so some edits are inherently more constrained.',
            'With complex PDFs, exact font preservation and pixel-level positioning may not reproduce perfectly. When exact design fidelity is essential, the editable source document remains the better source of truth.',
          ],
        },
      ]}
      faqs={[
        {
          question: 'What document formats can Plurilog edit?',
          answer: 'Current document-editing workflows support Word documents and supported PDFs. Common text-based files can also be analysed in the discussion.',
        },
        {
          question: 'Can I ask for edits in plain English?',
          answer: 'Yes. You can describe the requested change conversationally and continue with follow-up revisions in the same discussion.',
        },
        {
          question: 'Can different AI models review the same document?',
          answer: 'Yes. Relevant file context can remain available to participating AI seats, so different models can analyse, critique or build on the same document workflow.',
        },
        {
          question: 'Is PDF editing as flexible as Word editing?',
          answer: 'No. PDFs are fixed-layout documents, so complex typography and exact positional edits can be more constrained than edits to a DOCX source file.',
        },
      ]}
      related={[
        { href: '/ai-word-document-generator', title: 'Word document generator', description: 'Create a new downloadable DOCX from a conversation.' },
        { href: '/ai-pdf-editor', title: 'AI PDF editor', description: 'Focus specifically on analysing and revising PDF files.' },
        { href: '/chatgpt-claude-gemini', title: 'Multi-model AI conversation', description: 'See how the shared ChatGPT, Claude and Gemini panel works.' },
      ]}
    />
  );
}
