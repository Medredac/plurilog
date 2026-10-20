import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { MotionReveal } from '@/components/MotionReveal';
import { PlurilogMark } from '@/components/PlurilogMark';

const canonical = "https://plurilogai.com/blog/how-to-write-with-ai-without-losing-your-voice";
const title = "How to Write With AI Without Losing Your Voice";
const description = "Learn to write with AI while keeping your own voice. Practical editing prompts, story bible tips, continuity checks and multi-AI feedback for fiction writers.";
const published = '2026-10-17T00:00:00.000Z';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    title: title + ' | Plurilog',
    description,
    url: canonical,
    siteName: 'Plurilog',
    locale: 'en_US',
    type: 'article',
    publishedTime: published,
    images: [{ url: 'https://plurilogai.com/opengraph-image.png', width: 1200, height: 630, alt: 'Plurilog shared AI writing and editing workspace' }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['https://plurilogai.com/twitter-image.png'],
  },
};

const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: title,
  description,
  image: 'https://plurilogai.com/opengraph-image.png',
  datePublished: published,
  dateModified: published,
  author: { '@type': 'Organization', name: 'Plurilog', url: 'https://plurilogai.com' },
  publisher: { '@type': 'Organization', name: 'Plurilog', url: 'https://plurilogai.com',
    logo: { '@type': 'ImageObject', url: 'https://plurilogai.com/logo.svg' } },
  mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
};
const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://plurilogai.com/' },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://plurilogai.com/blog' },
    { '@type': 'ListItem', position: 3, name: title, item: canonical },
  ],
};

type ContentBlock =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'prompt'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'quote'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

const intro: string[] = [
  "You've spent an hour working on a scene. The dialogue is almost right, the pacing feels uneven, and the ending seems to be missing something. So you ask an AI to improve it.",
  "Seconds later, it hands back a smooth, polished rewrite. The grammar is immaculate. The characters explain how they feel. The dialogue sounds professional.",
  "There's just one problem: it no longer sounds like you.",
  "Writing with AI can be enormously useful—but only if you stay in charge of the voice, facts, and choices that make your work your own. The goal is not to accept every suggestion. It's to get clearer about which changes help the story."
];
const sections: { title: string; blocks: ContentBlock[] }[] = [
  {
    "title": "1. Use AI to understand your writing before asking it to replace the words",
    "blocks": [
      {
        "type": "p",
        "text": "There is a difference between asking for a rewrite and asking for an editorial opinion. “Make this more emotional” gives a model permission to replace your style with its own default version of emotional writing. “Where does the emotion fail to reach the reader, and why?” asks it to diagnose a problem first."
      },
      {
        "type": "p",
        "text": "For writers who want their voice to remain recognizable, diagnosis is often a better starting point than regeneration. Have the AI identify a problem, quote the sentence that causes it, and explain the reader’s likely experience. Then decide whether you agree."
      },
      {
        "type": "table",
        "headers": [
          "Instead of asking…",
          "Try asking…"
        ],
        "rows": [
          [
            "Rewrite this scene to make it better.",
            "Identify up to three issues with pacing or clarity. Explain each before suggesting changes."
          ],
          [
            "Make my character more emotional.",
            "Where is the character’s feeling insufficiently supported by action or subtext?"
          ],
          [
            "Fix the dialogue.",
            "Which lines sound inconsistent with this character, and why?"
          ]
        ]
      },
      {
        "type": "prompt",
        "text": "Act as a developmental editor. Read this scene and identify at most three issues that materially affect clarity, pacing, character motivation, or emotional impact. Quote the exact passage and explain why it may not work. Separate genuine issues from personal stylistic preferences. Do not rewrite the scene unless I approve a specific change."
      }
    ]
  },
  {
    "title": "2. Recognize when a smoother rewrite has made the scene worse",
    "blocks": [
      {
        "type": "p",
        "text": "Consider this original fictional passage:"
      },
      {
        "type": "quote",
        "text": "Nora pushed the letter beneath the fruit bowl when the doorbell rang. There hadn't been any fruit in it since February.\n\nHer mother was early, which was a kind of accusation."
      },
      {
        "type": "p",
        "text": "A well-meaning AI might turn it into something like this:"
      },
      {
        "type": "quote",
        "text": "Nora’s heart raced as the doorbell shattered the silence. She quickly concealed the mysterious letter, anxiety rising as she realized her mother had arrived unexpectedly."
      },
      {
        "type": "p",
        "text": "The rewrite is explicit and fluid. It also removes the empty fruit bowl, the dry humor, and the particular relationship implied by “a kind of accusation.” It explains an emotion the original chose to leave beneath the surface."
      },
      {
        "type": "p",
        "text": "This is not evidence that AI is always bad at prose. It is evidence that “polished” and “effective” are not synonyms. Writers can deliberately use restraint, awkwardness, repetition, or unusual details. Those choices can be exactly what makes a sentence theirs."
      },
      {
        "type": "p",
        "text": "A better editorial question might be whether the letter’s importance will become clear soon enough, or whether a reader understands why Nora hides it. Those questions preserve the author’s ability to choose how the scene should sound."
      }
    ]
  },
  {
    "title": "3. Create a short voice guide the AI can actually use",
    "blocks": [
      {
        "type": "p",
        "text": "“Keep my voice” is a good intention, but it is not a detailed instruction. Help the model by showing it a representative sample and naming the choices that make your prose recognizable."
      },
      {
        "type": "table",
        "headers": [
          "Element",
          "Example writing preference"
        ],
        "rows": [
          [
            "Point of view",
            "Close third-person; stay inside one character’s perceptions"
          ],
          [
            "Rhythm",
            "Concise sentences, interrupted by occasional longer reflections"
          ],
          [
            "Dialogue",
            "Understated; characters rarely say exactly what they mean"
          ],
          [
            "Emotional register",
            "Suggest feelings through actions and omissions"
          ],
          [
            "Description",
            "Concrete, selective observations rather than elaborate imagery"
          ],
          [
            "Avoid",
            "Automatic metaphors, generic inspirational endings, excessive explanations"
          ]
        ]
      },
      {
        "type": "p",
        "text": "Keep this guide alongside your draft. You can update it as your project develops. Do not let it become a rigid formula: your writing may need to change pace and tone from scene to scene."
      },
      {
        "type": "prompt",
        "text": "Read my writing sample and this voice guide. List the stylistic choices that make the sample distinctive, including rhythm, point of view, dialogue, imagery, and emotional restraint. When critiquing future scenes, preserve those choices unless I ask otherwise. If a sentence is unusual, first consider whether that unusual quality is intentional."
      }
    ]
  },
  {
    "title": "4. Get useful criticism instead of endless praise",
    "blocks": [
      {
        "type": "p",
        "text": "Writers often seek AI feedback because getting a fresh reader is difficult. But glowing assessments can become a problem of their own. A model that calls every chapter “powerful” or rates everything 9.5/10 does not help you locate the next revision."
      },
      {
        "type": "p",
        "text": "The opposite instruction—“be brutal, find everything wrong”—can be just as unreliable. An assistant may invent flaws to satisfy the demand for criticism. What matters is whether its claims are supported by the writing in front of it."
      },
      {
        "type": "prompt",
        "text": "Review this chapter as a careful, constructively skeptical reader. Identify two things that genuinely work and up to three issues worth revisiting, only if the evidence supports them. Cite the relevant sentences and explain the stakes for the reader. Do not assign a numerical score. If you are uncertain whether something is intentional, ask me rather than assuming it is a mistake."
      },
      {
        "type": "p",
        "text": "Then push back on the feedback. Ask, “Which earlier scene contradicts this motivation?” or “Why must the reader know that information now?” A critique becomes useful when you can test the reasoning, not when it merely sounds authoritative."
      },
      {
        "type": "link",
        "text": "For more on confident but unreliable AI claims, see Plurilog’s guide to AI hallucinations.",
        "href": "/blog/ai-hallucinations-chatgpt-claude-gemini"
      }
    ]
  },
  {
    "title": "5. Use a story bible to keep chapters and characters consistent",
    "blocks": [
      {
        "type": "p",
        "text": "Long projects accumulate facts: injuries, ages, relationships, promises, timelines, secrets, rules, and decisions that only become important several chapters later. When those facts are scattered across drafts and chats, continuity errors become easy."
      },
      {
        "type": "p",
        "text": "A story bible is simply a maintained reference for the information your story has established. It can be a short document at first. What matters is that it remains authoritative."
      },
      {
        "type": "table",
        "headers": [
          "Reference document",
          "Keep track of"
        ],
        "rows": [
          [
            "Characters",
            "Motivations, relationships, speaking habits, backstory, what each person knows"
          ],
          [
            "Timeline",
            "Major events, dates, injuries, locations, promises, revelations"
          ],
          [
            "Outline",
            "Completed beats, planned beats, unresolved threads"
          ],
          [
            "Voice guide",
            "Narration, viewpoint, dialogue, stylistic boundaries"
          ]
        ]
      },
      {
        "type": "p",
        "text": "Crucially, do not let an AI’s brainstorm quietly become canon. Mark story information as established, planned, proposed, or rejected. A theory suggested in chapter six is not suddenly a fact in chapter nine unless you accept it."
      },
      {
        "type": "prompt",
        "text": "Check this chapter against the supplied story bible. Report only continuity problems you can substantiate. For each, quote the chapter passage and the conflicting established fact. Separate verified contradictions from unanswered questions. Do not treat proposed or rejected story ideas as canon. If a relevant earlier chapter is missing, say the check is incomplete."
      }
    ]
  },
  {
    "title": "6. Revise in passes so one fix does not create three new problems",
    "blocks": [
      {
        "type": "p",
        "text": "A full-chapter rewrite can obscure what changed. It might improve pacing but damage character voice, reveal a secret too early, or accidentally move an event in the timeline."
      },
      {
        "type": "list",
        "items": [
          "Structure: Does the scene have a purpose, and does anything change between the beginning and end?",
          "Character: Do actions follow from the character’s motivations and knowledge at this moment?",
          "Dialogue: Is each voice distinctive, and is the subtext doing enough work?",
          "Prose: Are there genuinely unclear or repetitive sentences?",
          "Continuity: Does the revised scene still agree with the story bible and preceding chapters?"
        ]
      },
      {
        "type": "p",
        "text": "Give the AI one revision goal at a time. Ask it to identify candidate edits first, then approve or reject individual suggestions. You should be able to explain why each change is being made."
      },
      {
        "type": "prompt",
        "text": "We are revising only dialogue in this scene. Identify lines that feel inconsistent with established character voices and suggest alternatives only for those lines. Preserve the plot, narration, emotional intent, and all factual details. Present proposed changes separately so I can approve them one by one."
      }
    ]
  },
  {
    "title": "7. Bring in another AI when the editorial choice is genuinely difficult",
    "blocks": [
      {
        "type": "p",
        "text": "A single editorial opinion can be persuasive, particularly when it is confidently written. But writing judgments are not always objective. One reader may call an opening slow; another may value its atmosphere. The question is not which opinion receives the most votes. It is what each interpretation notices."
      },
      {
        "type": "p",
        "text": "This is where Plurilog’s shared conversation becomes useful. ChatGPT, Claude, and Gemini can participate in one discussion with relevant shared context. Later participating models can examine earlier feedback, question assumptions, and add another perspective rather than requiring you to paste the manuscript and previous critiques into separate applications."
      },
      {
        "type": "p",
        "text": "You might upload a scene, character notes, and an outline. Ask one model for developmental feedback. Then have another examine whether the criticism is supported by the text or merely a stylistic preference. A third can identify something both overlooked. The sequence and models are configurable; no one model is guaranteed to be the best fiction editor."
      },
      {
        "type": "prompt",
        "text": "Read the excerpt, story references, and the feedback already given in this discussion. Where do the editorial assessments genuinely disagree? Identify which comments are supported by passages, which depend on taste, and which require information we have not supplied. Do not agree simply because another AI spoke first. Help me decide what to investigate, not what I must change."
      },
      {
        "type": "p",
        "text": "Multiple AI opinions do not guarantee correctness. Models can repeat the same assumption or reinforce an error. The benefit is being able to inspect competing reasons without losing the thread of the work."
      },
      {
        "type": "link",
        "text": "Explore how ChatGPT, Claude, and Gemini participate in one shared Plurilog conversation.",
        "href": "/chatgpt-claude-gemini"
      }
    ]
  },
  {
    "title": "8. Keep your manuscript—not your AI chat—as the source of truth",
    "blocks": [
      {
        "type": "p",
        "text": "A novel may take months or years. During that time, you may abandon an ending, revise a character’s history, or replace an entire chapter. Your accepted manuscript and story bible should outlast any one editing session."
      },
      {
        "type": "p",
        "text": "At the end of a discussion, ask AI to separate decisions you explicitly approved from changes it merely suggested. Review the list, update your reference documents, and keep versioned copies of the manuscript."
      },
      {
        "type": "prompt",
        "text": "Summarize this editing session in three groups: changes I explicitly approved, suggestions I rejected, and questions still open. Cite the relevant parts of our conversation where possible. Do not convert your own unaccepted suggestions into author decisions. Then give me a checklist for updating the manuscript and story bible."
      },
      {
        "type": "p",
        "text": "Plurilog supports working with uploaded documents and creating downloadable Word and PDF files. That allows you to discuss the edit with multiple models and produce a document when the decisions are settled. For a large manuscript, supply the relevant chapters and references explicitly; do not assume any AI has perfect recall of the whole novel."
      },
      {
        "type": "link",
        "text": "See Plurilog’s guide to creating Word documents with AI.",
        "href": "/ai-word-document-generator"
      }
    ]
  },
  {
    "title": "9. Know when to close the AI window",
    "blocks": [
      {
        "type": "p",
        "text": "There is a point where more critique becomes another form of procrastination. You can ask for five rewrites, examine three alternate endings, and debate every metaphor without getting closer to a finished story."
      },
      {
        "type": "p",
        "text": "Sometimes the better next step is to finish the chapter, let it sit overnight, read it aloud, or give it to a trusted human reader. Beta readers and editors can tell you how a scene actually lands for another person in ways that no model consensus can conclusively establish."
      },
      {
        "type": "p",
        "text": "You are allowed to keep the odd sentence an AI wants to smooth away. If you know why it belongs, that is an editorial decision—not a failure to accept help."
      }
    ]
  }
];
const faqs: [string, string][] = [
  [
    "Can I use AI to write a novel without letting it write the novel for me?",
    "Yes. You can use AI for outlines, developmental editing, plot-hole checks, character interviews, continuity analysis, and revision plans while writing every sentence yourself. You control how much work you delegate."
  ],
  [
    "How do I stop AI from changing my writing style?",
    "Show it representative prose, create a short voice guide, request diagnosis before rewriting, and approve changes individually. Treat style suggestions as optional, not mandatory."
  ],
  [
    "Can an AI remember an entire book accurately?",
    "Not automatically. Access to earlier text depends on the product, context, and supplied materials. A maintained story bible, relevant chapters, and explicit continuity checks reduce risk but do not eliminate mistakes."
  ],
  [
    "Is ChatGPT, Claude, or Gemini best for fiction editing?",
    "Any of the three can help. Results vary by task, model, prompt, and reference material. Compare evidence-backed feedback on the passage at hand rather than assuming a universal winner."
  ],
  [
    "Is AI feedback enough before publishing?",
    "No. Human readers, editors, and writing groups provide important reactions. Check the AI-content policies of any publisher, platform, or competition you plan to use."
  ]
];

function ArticleBlock({ block }: { block: ContentBlock }) {
  if (block.type === 'p') return <p>{block.text}</p>;
  if (block.type === 'list') return (
    <ul className="list-disc pl-5 space-y-1.5 text-zinc-600">
      {block.items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
  if (block.type === 'prompt') return (
    <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-5 space-y-2">
      <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Try this prompt</p>
      <p className="text-zinc-700 italic">{block.text}</p>
    </div>
  );
  if (block.type === 'quote') return (
    <blockquote className="whitespace-pre-line rounded-xl border-l-2 border-zinc-800 bg-zinc-50 px-5 py-4 text-zinc-700 italic">{block.text}</blockquote>
  );
  if (block.type === 'link') return (
    <p><Link href={block.href} className="text-zinc-900 underline hover:no-underline font-medium">{block.text}</Link></p>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full text-left text-sm border-collapse">
        <thead className="bg-zinc-50 text-zinc-900"><tr>{block.headers.map((h) => <th key={h} className="p-3 border-b border-zinc-200 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, index) => <tr key={index} className="border-b border-zinc-100 last:border-b-0">{row.map((cell, i) => <td key={i} className="p-3 align-top text-zinc-600">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function WritingWithAiBlogPost() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <SiteHeader />
      <main className="flex-1 bg-tech-grid">
        <div className="max-w-3xl mx-auto w-full px-6 sm:px-8 py-12 sm:py-16">
          <Link href="/blog" className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-700 transition-colors mb-6 cursor-pointer group">
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
            <span>Back to Blog</span>
          </Link>
          <MotionReveal className="mb-8">
            <time dateTime="2026-10-17" className="text-xs font-medium text-zinc-400 block mb-2.5">October 17, 2026</time>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 leading-tight mb-6">{title}</h1>
            <div className="aspect-[16/9] w-full rounded-2xl overflow-hidden border border-zinc-200/80 shadow-2xs bg-zinc-100">
              <video src="/write-with-ai-keep-your-voice.mp4" poster="/opengraph-image.png"
                autoPlay loop muted playsInline preload="metadata" controls={false}
                disablePictureInPicture disableRemotePlayback controlsList="nodownload nofullscreen noremoteplayback"
                aria-hidden="true" tabIndex={-1} className="w-full h-full object-cover pointer-events-none select-none" />
            </div>
          </MotionReveal>
          <article className="text-sm sm:text-base text-zinc-600 leading-relaxed space-y-8">
            <MotionReveal delay={0.04} className="space-y-4">
              {intro.slice(0,3).map((text) => <p key={text}>{text}</p>)}
              <p className="text-base sm:text-lg font-semibold text-zinc-900 pl-4 border-l-2 border-zinc-900">{intro[3]}</p>
            </MotionReveal>
            {sections.map((section) => (
              <MotionReveal key={section.title} as="section" className="space-y-4">
                <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">{section.title}</h2>
                {section.blocks.map((block, index) => <ArticleBlock key={index} block={block} />)}
              </MotionReveal>
            ))}
            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">Frequently asked questions</h2>
              {faqs.map(([question, answer]) => (
                <div key={question} className="space-y-2">
                  <h3 className="font-semibold text-zinc-900">{question}</h3>
                  <p>{answer}</p>
                </div>
              ))}
            </MotionReveal>
            <MotionReveal as="section" className="mt-12 p-8 sm:p-10 rounded-2xl bg-zinc-900 text-white text-center space-y-4 shadow-sm">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Your writing. More than one perspective.</h2>
              <p className="text-sm sm:text-base text-zinc-300 max-w-xl mx-auto leading-relaxed">
                Bring a scene, draft, or chapter into a shared discussion with ChatGPT, Claude and Gemini. Challenge editorial suggestions, check continuity, and keep the final creative decisions yours.
              </p>
              <div className="pt-2">
                <Link href="/?signup=true" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 font-semibold text-sm transition-colors shadow-xs cursor-pointer">
                  <span>Open your panel</span><ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </MotionReveal>
            <MotionReveal as="section" className="space-y-3">
              <h2 className="text-lg font-bold text-zinc-900">Explore more Plurilog guides</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li><Link href="/blog/chatgpt-claude-gemini-shared-conversation" className="text-zinc-900 underline hover:no-underline">Why we built Plurilog around one shared AI conversation</Link></li>
                <li><Link href="/blog/ai-hallucinations-chatgpt-claude-gemini" className="text-zinc-900 underline hover:no-underline">How to catch unreliable AI feedback</Link></li>
                <li><Link href="/ai-word-document-generator" className="text-zinc-900 underline hover:no-underline">Create and edit Word documents with AI</Link></li>
              </ul>
            </MotionReveal>
          </article>
        </div>
      </main>
      <footer className="px-6 sm:px-12 py-6 border-t border-zinc-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <PlurilogMark className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span>Plurilog &copy; {new Date().getFullYear()}</span>
        </div>
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
