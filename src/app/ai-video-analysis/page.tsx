import type { Metadata } from 'next';
import { SeoFeaturePage } from '@/components/SeoFeaturePage';

const canonical = 'https://plurilogai.com/ai-video-analysis';
const title = 'AI Video Analysis: Summarize & Transcribe Videos';
const description = 'Upload a video or paste a YouTube link. Use Gemini-powered AI video analysis to summarize scenes, transcribe speech and turn video into notes or new drafts.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    title: `${title} | Plurilog`,
    description,
    url: canonical,
    siteName: 'Plurilog',
    locale: 'en_US',
    type: 'website',
    images: [{ url: 'https://plurilogai.com/opengraph-image.png', width: 1200, height: 630, alt: 'Plurilog AI video analysis' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${title} | Plurilog`,
    description,
    images: ['https://plurilogai.com/twitter-image.png'],
  },
};

export default function AiVideoAnalysisPage() {
  return (
    <SeoFeaturePage
      eyebrow="Video uploads & YouTube links"
      title="AI Video Analysis: Summarize and Transcribe Videos"
      description="Upload a video or paste a public YouTube link to ask questions about what you see and hear. Get summaries, request a transcript with timestamps and turn the findings into useful notes, articles or scripts—all in one Plurilog discussion."
      canonical={canonical}
      sections={[
        {
          heading: 'Upload a video or paste a YouTube link',
          paragraphs: [
            'Start a discussion, attach an MP4, MOV or WebM video, or paste a public YouTube URL into your message. Tell the AI what you want to learn: a quick overview, spoken dialogue, an explanation of a scene or feedback on a presentation.',
            'For a question about a specific moment, include the timestamps and what to look for. For example: “Explain the demonstration from 02:10 to 03:00, including what the presenter says and shows.”',
          ],
          bullets: [
            'Add your video or YouTube link to a discussion.',
            'Ask for a summary, transcription or analysis, with any relevant time range.',
            'Use the findings to ask follow-up questions or develop a new piece of writing.',
          ],
        },
        {
          heading: 'Use AI to summarize YouTube videos',
          paragraphs: [
            'Turn an accessible YouTube video into a concise overview, a list of takeaways or study notes. Ask for the main argument of a talk, the steps in a tutorial or the key points of an interview, with relevant timestamps to help you revisit the source.',
            'Try: “Summarize this YouTube video in five bullet points. Include timestamps for the main ideas and separate the speaker’s claims from your own interpretation.”',
          ],
        },
        {
          heading: 'Video transcription: turn speech into text',
          paragraphs: [
            'Request a transcript of spoken content from your uploaded video or a public YouTube link. Specify whether you want the wording as spoken or a cleaned-up version with filler words removed, and ask for timestamps if you need to locate a passage.',
            'Try: “Transcribe the speech from 00:30 to 02:00 with timestamps. Keep the original wording and mark anything you cannot hear clearly.” AI transcription can miss words, names or overlapping speech, so check important quotations against the recording. For longer recordings, request manageable sections.',
          ],
        },
        {
          heading: 'Chat with a video about scenes, speech and details',
          paragraphs: [
            'Video analysis can help with more than a transcript. Ask about visible actions, the sequence of a demonstration, how a presentation supports its spoken message or what happens at a particular moment.',
            'Gemini handles the video inspection using its native audio and visual capabilities. ChatGPT, Claude and Gemini can then build on the resulting findings in your shared conversation. This gives you different perspectives on the findings without implying that each model independently watched the source.',
            'Try: “What does the presenter show while explaining this step? Describe the visible evidence and flag any detail that is unclear.”',
          ],
        },
        {
          heading: 'Turn video into notes, articles and rewritten scripts',
          paragraphs: [
            'Keep working after the summary. Turn the findings from a lecture into revision notes, a tutorial into written instructions or your own recorded presentation into a clearer script. You can also ask for a blog outline or social post based on the ideas discussed.',
            'Try: “Use the findings from my video to draft a short article. Keep the factual points, explain the steps clearly and flag anything that needs checking.” This rewrites the text you develop from the video; it does not edit the video file itself.',
          ],
        },
        {
          heading: 'What to know before analysing a video',
          paragraphs: [
            'Supported uploads are MP4, MOV and WebM, with a combined video limit of 500 MB per message. YouTube analysis requires a public video the service can access; private, removed or restricted videos may not work.',
            'Clear audio and readable visuals improve the results. Small on-screen text, fast action, background noise and overlapping speakers can make details uncertain. Timestamps and transcripts are AI-generated and should be checked when precision matters.',
            'Follow-up answers can use saved findings in the discussion. If you need a fresh inspection of an earlier uploaded video, you may be asked to upload it again. Include your main questions and relevant timestamps with the initial upload.',
          ],
        },
      ]}
      faqs={[
        {
          question: 'Can I paste a YouTube link and ask AI to summarize it?',
          answer: 'Yes. Paste a public YouTube link into Plurilog and ask for a summary, key takeaways or timestamped notes. The video must be accessible to the service.',
        },
        {
          question: 'Can Plurilog transcribe a YouTube video or an uploaded video?',
          answer: 'Yes. You can request spoken dialogue as text and ask for timestamps. Specify a time range for a focused transcript. Results depend on audio clarity and may contain errors, so verify important quotes against the recording.',
        },
        {
          question: 'Which video formats can I upload?',
          answer: 'Plurilog accepts MP4, MOV and WebM video uploads, with a combined limit of 500 MB of video per message. You can also paste an accessible public YouTube link.',
        },
        {
          question: 'Does the AI analyse the visuals as well as the audio?',
          answer: 'Yes. Gemini inspects the video’s visual and audio content to answer your question. Ask about scenes, visible actions and speech, and include timestamps when you want to focus on a particular moment.',
        },
        {
          question: 'Do ChatGPT, Claude and Gemini all watch the video?',
          answer: 'Gemini performs the video inspection. The participating models can use those findings in the shared discussion to explain, critique or develop your answer.',
        },
        {
          question: 'Can I turn a video into an article or rewrite its script?',
          answer: 'Yes. Ask the panel to use the video findings to draft notes, an article, a social post or a revised script. Review the source details before publishing. Plurilog generates text from the findings rather than editing the video file.',
        },
      ]}
      related={[
        { href: '/ai-pdf-editor', title: 'AI PDF workflows', description: 'Analyse documents alongside your video findings.' },
        { href: '/ai-word-document-generator', title: 'Create a Word document', description: 'Turn your discussion into a downloadable document.' },
        { href: '/chatgpt-claude-gemini', title: 'One shared AI conversation', description: 'Build on the findings with ChatGPT, Claude and Gemini.' },
      ]}
    />
  );
}
