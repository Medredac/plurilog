import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { MotionReveal } from '@/components/MotionReveal';
import { PlurilogMark } from '@/components/PlurilogMark';

export const metadata: Metadata = {
  title: 'ChatGPT, Claude and Gemini in One Conversation: Why We Built Plurilog',
  description:
    'Why Plurilog puts ChatGPT, Claude and Gemini into one shared AI conversation, how shared context works, and why multiple perspectives are more useful when they stay part of the same discussion.',
  alternates: {
    canonical: 'https://plurilogai.com/blog/chatgpt-claude-gemini-shared-conversation',
  },
  openGraph: {
    title: 'ChatGPT, Claude and Gemini in One Conversation: Why We Built Plurilog',
    description:
      'Why Plurilog puts ChatGPT, Claude and Gemini into one shared AI conversation, how shared context works, and why multiple perspectives are more useful when they stay part of the same discussion.',
    url: 'https://plurilogai.com/blog/chatgpt-claude-gemini-shared-conversation',
    siteName: 'Plurilog',
    locale: 'en_US',
    type: 'article',
    publishedTime: '2026-09-17T00:00:00.000Z',
    images: [
      {
        url: 'https://plurilogai.com/blog/why-we-built-plurilog-shared-ai-conversation.png',
        alt: 'Plurilog shared AI conversation with ChatGPT, Claude and Gemini',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ChatGPT, Claude and Gemini in One Conversation: Why We Built Plurilog',
    description:
      'Why Plurilog puts ChatGPT, Claude and Gemini into one shared AI conversation, how shared context works, and why multiple perspectives are more useful when they stay part of the same discussion.',
    images: ['https://plurilogai.com/blog/why-we-built-plurilog-shared-ai-conversation.png'],
  },
};

const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: 'Why We Built Plurilog Around One Shared AI Conversation',
  description:
    'Why Plurilog puts ChatGPT, Claude and Gemini into one shared AI conversation, how shared context works, and why multiple perspectives are more useful when they stay part of the same discussion.',
  image: 'https://plurilogai.com/blog/why-we-built-plurilog-shared-ai-conversation.png',
  datePublished: '2026-09-17T00:00:00.000Z',
  dateModified: '2026-09-17T00:00:00.000Z',
  author: {
    '@type': 'Organization',
    name: 'Plurilog',
    url: 'https://plurilogai.com',
  },
  publisher: {
    '@type': 'Organization',
    name: 'Plurilog',
    url: 'https://plurilogai.com',
    logo: {
      '@type': 'ImageObject',
      url: 'https://plurilogai.com/logo.svg',
    },
  },
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': 'https://plurilogai.com/blog/chatgpt-claude-gemini-shared-conversation',
  },
};

export default function WhyWeBuiltPlurilogSharedConversationBlogPost() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 font-sans selection:bg-amber-100 selection:text-zinc-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />

      {/* Navigation Header */}
      <SiteHeader />

      {/* Main Content Column */}
      <main className="flex-1 bg-tech-grid">
        <div className="max-w-3xl mx-auto w-full px-6 sm:px-8 py-12 sm:py-16">
          {/* Back to blog navigation */}
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-700 transition-colors mb-6 cursor-pointer group"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
            <span>Back to Blog</span>
          </Link>

          {/* Article Header */}
          <MotionReveal className="mb-8">
            <time dateTime="2026-09-17" className="text-xs font-medium text-zinc-400 block mb-2.5">
              September 17, 2026
            </time>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 leading-tight mb-6">
              Why We Built Plurilog Around One Shared AI Conversation
            </h1>
            <div className="aspect-[16/9] w-full rounded-2xl overflow-hidden border border-zinc-200/80 shadow-2xs bg-zinc-100">
              <img
                src="/blog/why-we-built-plurilog-shared-ai-conversation.png"
                alt="Plurilog shared AI conversation with ChatGPT, Claude and Gemini"
                className="w-full h-full object-cover"
              />
            </div>
          </MotionReveal>

          {/* Article Body */}
          <article className="text-sm sm:text-base text-zinc-600 leading-relaxed space-y-8">
            <MotionReveal delay={0.04} className="space-y-4">
              <p>
                ChatGPT, Claude and Gemini are all useful. The problem begins when the same piece of work is spread across three separate conversations. Plurilog was built to give multiple AI models one continuing discussion, with shared context, files and history.
              </p>
              <p>
                AI tools have become part of everyday work remarkably quickly. But as people have become more comfortable using them, another behaviour has emerged just as quickly: relying on more than one.
              </p>
              <p>
                You might start a piece of research in ChatGPT, ask Claude to challenge an assumption, then open Gemini because you want another perspective. If the task matters, using another model can be useful precisely because no single AI is infallible.
              </p>
              <p>
                The problem is what happens next.
              </p>
              <p>
                You paste the original prompt into another window. Then you paste the useful part of the first answer. Perhaps you upload the same document again. A few turns later, one conversation contains a clarification that the others have never seen. Another has a revised file. A third is still operating on assumptions you corrected twenty minutes ago.
              </p>
              <p>
                What began as one problem has quietly become three different conversations.
              </p>
              <p>
                That is the problem we built Plurilog to solve.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                The problem was not having too many tabs
              </h2>
              <p>
                Closing a few browser tabs would not have fixed the underlying issue.
              </p>
              <p>
                The real problem was fragmented context.
              </p>
              <p>
                A conversation with an AI is rarely just the first prompt. Over time, it accumulates information:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-zinc-600">
                <li>what you are trying to accomplish;</li>
                <li>documents and images you have provided;</li>
                <li>corrections you have made;</li>
                <li>decisions already reached;</li>
                <li>constraints that emerged later;</li>
                <li>useful points from earlier responses;</li>
                <li>questions that remain unresolved.</li>
              </ul>
              <p>
                That accumulated context is often what makes later answers useful.
              </p>
              <p>
                Once a task is divided between separate AI products, however, that history fragments with it. One model knows something another does not. Files have to be uploaded again. Relevant answers have to be pasted between windows. The user becomes responsible for manually synchronising the discussion.
              </p>
              <p>
                Multi-model AI should not require the human to act as middleware.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                Putting several models on one screen was not enough
              </h2>
              <p>
                There is an obvious way to build a product involving several AI models: send the same prompt to each of them and display the outputs next to one another.
              </p>
              <p>
                Technically, that is relatively straightforward.
              </p>
              <p>
                It also was not what we wanted to build.
              </p>
              <p>
                Plurilog is designed around a different idea: the models participate in the same ongoing discussion.
              </p>
              <p>
                That distinction matters.
              </p>
              <p>
                If ChatGPT has already raised an important concern, Claude can respond to that concern. If Claude identifies a weakness in the reasoning, Gemini can address it. If the user corrects an assumption, that correction becomes part of the discussion going forward.
              </p>
              <p>
                The interaction does not have to restart every time another model speaks.
              </p>
              <div className="space-y-3 pt-1 pb-1">
                <p className="text-base sm:text-lg font-semibold text-zinc-900 pl-4 border-l-2 border-zinc-300">
                  &ldquo;Claude, challenge the assumption ChatGPT just made.&rdquo;
                </p>
                <p className="text-base sm:text-lg font-semibold text-zinc-900 pl-4 border-l-2 border-zinc-300">
                  &ldquo;Gemini, is there anything missing from that reasoning?&rdquo;
                </p>
                <p className="text-base sm:text-lg font-semibold text-zinc-900 pl-4 border-l-2 border-zinc-300">
                  &ldquo;ChatGPT, build on Claude&apos;s suggestion but account for the constraint I mentioned earlier.&rdquo;
                </p>
              </div>
              <p>
                Those requests only make sense if the models are participating in a common conversational context.
              </p>
              <p>
                That is the difference between access to several AIs and an actual multi-model AI conversation.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                The discussion has to be the source of truth
              </h2>
              <p>
                This creates a less visible engineering problem.
              </p>
              <p>
                ChatGPT, Claude and Gemini are different systems operated by different providers. They do not naturally share a conversation with one another. Each provider has its own way of representing messages, instructions, files and conversational state.
              </p>
              <p>
                So Plurilog cannot simply rely on one provider&apos;s native chat history and expect another provider to understand it.
              </p>
              <p>
                Instead, the discussion itself has to belong to Plurilog.
              </p>
              <p>
                When a model is asked to participate, Plurilog assembles the relevant shared context and presents it in the form that model needs. The objective is that each participant responds to the same evolving task rather than to an isolated version of it.
              </p>
              <p>
                That architectural idea was one of the most important decisions behind the product.
              </p>
              <p>
                A recent <a href="https://www.elma.sh/blog/multi-model-ai-chat-shared-context" target="_blank" rel="noopener noreferrer" className="text-zinc-900 underline hover:no-underline font-medium">outside analysis of Plurilog</a> described this as the real challenge of multi-model AI: not simply routing a request to several providers, but maintaining a trustworthy shared context between them. That is a fair description.
              </p>
              <p>
                The visible chat interface is only the surface. The more important question underneath it is:
              </p>
              <p className="text-base sm:text-lg font-semibold text-zinc-900 pl-4 border-l-2 border-zinc-300">
                What does every model know when it answers?
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                Shared context changes the unit of work
              </h2>
              <p>
                Traditional AI chat tends to make the prompt feel like the basic unit of work.
              </p>
              <p>
                But real tasks are rarely one prompt long.
              </p>
              <p>
                A research task might contain source documents, objections, corrections and several rounds of analysis. A product decision might involve customer feedback, technical constraints and conclusions already reached. A writing project might evolve through outlines, drafts, criticism and revision.
              </p>
              <p>
                In that kind of work, the useful unit is not the individual prompt.
              </p>
              <p>
                It is the discussion as a whole.
              </p>
              <p>
                An <a href="https://www.elma.sh/blog/multi-model-ai-chat-shared-context" target="_blank" rel="noopener noreferrer" className="text-zinc-900 underline hover:no-underline font-medium">external analysis of Plurilog</a> made a similar point, describing the richer unit of work as something closer to a &ldquo;case file&rdquo;: the goal, source material, decisions, model responses, objections and constraints together.
              </p>
              <p>
                That framing closely matches how we think about Plurilog.
              </p>
              <p>
                The conversation should become a persistent workspace around the task.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                Why disagreement is useful
              </h2>
              <p>
                Plurilog is not built on the idea that three AIs agreeing with one another somehow proves that an answer is correct.
              </p>
              <p>
                It does not.
              </p>
              <p>
                AI models can make the same mistake. They can inherit a faulty assumption from the conversation. They can be persuaded by a confidently stated claim. And several plausible responses are still not a substitute for evidence.
              </p>
              <p>
                The value of multiple perspectives is not automatic truth.
              </p>
              <p>
                It is visibility.
              </p>
              <p>
                A single polished AI answer can conceal uncertainty surprisingly well. Introduce another capable model into the discussion and different things may happen:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-zinc-600">
                <li>it may agree but supply different reasoning;</li>
                <li>it may notice an omitted constraint;</li>
                <li>it may challenge an assumption;</li>
                <li>it may interpret ambiguous evidence differently;</li>
                <li>it may identify something neither the user nor the first model considered.</li>
              </ul>
              <p>
                That disagreement can be more useful than consensus.
              </p>
              <p>
                <a href="https://www.elma.sh/blog/multi-model-ai-chat-shared-context" target="_blank" rel="noopener noreferrer" className="text-zinc-900 underline hover:no-underline font-medium">Elma&apos;s analysis</a> makes the same caution: models responding to one another can also reinforce a bad claim, so agreement should not be treated as independent verification.
              </p>
              <p>
                We agree.
              </p>
              <p>
                The point of Plurilog is not to manufacture consensus. It is to make more of the reasoning visible so that the human can make a better-informed judgement.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                Why we call it an AI panel
              </h2>
              <p>
                The word panel captures the product better than many technical descriptions do.
              </p>
              <p>
                Imagine asking several knowledgeable people for help with a problem.
              </p>
              <p>
                There is a major difference between:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-zinc-600">
                <li>interviewing each person separately without telling them what anyone else has said; and</li>
                <li>putting them around the same table and allowing them to hear the discussion.</li>
              </ul>
              <p>
                In the second case, one participant can question another. Someone can add missing information. An objection can change the direction of the conversation. A later contribution can build on something useful that emerged earlier.
              </p>
              <p>
                That is much closer to the experience we wanted.
              </p>
              <p>
                Plurilog is an AI panel because the participants are not simply producing isolated outputs. They are contributing to one evolving discussion.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                Files make shared context even more important
              </h2>
              <p>
                The problem becomes more obvious when the task involves more than text.
              </p>
              <p>
                People increasingly use AI with:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-zinc-600">
                <li>PDFs;</li>
                <li>reports;</li>
                <li>screenshots;</li>
                <li>photographs;</li>
                <li>presentations;</li>
                <li>research material;</li>
                <li>other working documents.</li>
              </ul>
              <p>
                If you are working across several separate AI products, those materials become another thing you have to manage manually.
              </p>
              <p>
                Upload the file here. Upload it again there. Explain which page matters. Paste a correction into another conversation. Discover later that one model was working from an earlier version.
              </p>
              <p>
                That is precisely the kind of friction a shared workspace should remove.
              </p>
              <p>
                Plurilog supports files and images as part of the discussion so that the user&apos;s work can remain centred on the task rather than on repeatedly reconstructing the context.
              </p>
              <p>
                And this is where the question of shared context stops being an abstract technical concern.
              </p>
              <p>
                If different AI models are supposed to reason about the same problem, they need access to the relevant information behind that problem.
              </p>
              <p>
                An <a href="https://www.elma.sh/blog/multi-model-ai-chat-shared-context" target="_blank" rel="noopener noreferrer" className="text-zinc-900 underline hover:no-underline font-medium">outside analysis of Plurilog</a> correctly points out that multimodal work raises the stakes considerably: differences in how a file is parsed, represented or supplied can influence the models&apos; responses.
              </p>
              <p>
                That is an area we expect to keep improving as the product develops.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                The user should still be in control
              </h2>
              <p>
                There is another reason we did not want Plurilog to behave like a black-box &ldquo;AI council&rdquo; that automatically decides everything on the user&apos;s behalf.
              </p>
              <p>
                Different tasks benefit from different arrangements.
              </p>
              <p>
                Sometimes you want all three models involved.
              </p>
              <p>
                Sometimes you want one model to answer first and another to respond afterward.
              </p>
              <p>
                Sometimes you want Claude but not Gemini.
              </p>
              <p>
                Sometimes you want ChatGPT to take the lead.
              </p>
              <p>
                Sometimes one response is enough.
              </p>
              <p>
                Plurilog therefore lets the user control the panel: which models participate, who responds and how the discussion proceeds.
              </p>
              <p>
                The goal is not to maximize the number of AI responses.
              </p>
              <p>
                The goal is to make additional perspectives available when they are useful.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                One subscription instead of three separate workflows
              </h2>
              <p>
                There is also a much simpler practical reason behind the product.
              </p>
              <p>
                People interested in several leading AI models have traditionally had to maintain separate accounts, interfaces and sometimes separate subscriptions.
              </p>
              <p>
                Even after paying for them, they remain separate environments.
              </p>
              <p>
                Plurilog brings access to ChatGPT, Claude and Gemini into one place under one Plurilog subscription.
              </p>
              <p>
                But we do not think the main value is simply bundling access.
              </p>
              <p>
                If that were all Plurilog did, it would still leave the most annoying part of the workflow untouched.
              </p>
              <p>
                The value is that those models can participate in the same work.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                What Plurilog is not trying to do
              </h2>
              <p>
                We are deliberately not positioning Plurilog as a machine that turns three AI responses into guaranteed truth.
              </p>
              <p>
                Nor do we believe every trivial question requires three models.
              </p>
              <p>
                If you want to know how many tablespoons are in a cup, involving an entire panel would be absurd.
              </p>
              <p>
                Multi-model discussion becomes interesting when there is something worth examining:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-zinc-600">
                <li>a difficult decision;</li>
                <li>uncertain reasoning;</li>
                <li>research that needs scrutiny;</li>
                <li>a document that can be interpreted several ways;</li>
                <li>a technical design with trade-offs;</li>
                <li>a piece of writing that benefits from criticism;</li>
                <li>a problem where missing one assumption matters.</li>
              </ul>
              <p>
                The human still determines what to trust and what to do.
              </p>
              <p>
                The AI panel exists to broaden the reasoning available to that person, not to replace their judgement.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                Why this matters as AI models keep changing
              </h2>
              <p>
                The AI market moves extremely quickly.
              </p>
              <p>
                A model that is strongest for one kind of work today may not be six months from now. Providers release new generations, change capabilities and improve different parts of their systems at different rates.
              </p>
              <p>
                That makes us increasingly interested in the conversation layer above the models.
              </p>
              <p>
                The enduring part of someone&apos;s work should not have to belong to whichever AI provider happened to receive the first prompt.
              </p>
              <p>
                The task, the files, the decisions and the discussion should remain coherent even as different models participate.
              </p>
              <p>
                This is one reason we think multi-model AI will become less about switching between model interfaces and more about orchestration: maintaining the workspace while choosing which intelligence to bring into it.
              </p>
              <p>
                <a href="https://www.elma.sh/blog/multi-model-ai-chat-shared-context" target="_blank" rel="noopener noreferrer" className="text-zinc-900 underline hover:no-underline font-medium">Elma&apos;s article</a> reaches a similar conclusion, arguing that the orchestration layer itself may become the defining product rather than simply the list of providers available in a dropdown.
              </p>
              <p>
                That is much closer to how we see the opportunity.
              </p>
            </MotionReveal>

            <MotionReveal as="section" className="space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                What we are building toward
              </h2>
              <p>
                Plurilog is still evolving.
              </p>
              <p>
                There are many things we want to make better: how shared context is managed, how files are handled, how clearly the discussion shows where an idea originated, how users control the panel, and how naturally multiple models can participate without making the experience noisy.
              </p>
              <p>
                But the principle underneath the product is unlikely to change.
              </p>
              <p>
                We do not think the future of serious AI work is simply choosing one model and remaining permanently inside one provider&apos;s ecosystem.
              </p>
              <p>
                And we do not think the answer is opening several tabs and manually carrying the same task between them.
              </p>
              <p>
                We think there is a more useful model:
              </p>
              <p className="text-base sm:text-lg font-semibold text-zinc-900 pl-4 border-l-2 border-zinc-300">
                one workspace, one evolving discussion, and multiple AI perspectives available inside it.
              </p>
              <p>
                The conversation should remain coherent even when the intelligence participating in it changes.
              </p>
              <p>
                That is why we built Plurilog.
              </p>
            </MotionReveal>

            {/* FAQ Section (visible article content only) */}
            <MotionReveal as="section" className="space-y-6 pt-6 border-t border-zinc-200/80">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                FAQ
              </h2>

              <div className="space-y-2">
                <h3 className="text-base sm:text-lg font-semibold text-zinc-900">
                  What is multi-model AI chat?
                </h3>
                <p>
                  Multi-model AI chat allows more than one AI model to participate within the same workflow or conversation. In Plurilog, ChatGPT, Claude and Gemini can participate in one continuing discussion rather than requiring the user to recreate the task separately in each service.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-base sm:text-lg font-semibold text-zinc-900">
                  Can ChatGPT, Claude and Gemini see one another&apos;s responses in Plurilog?
                </h3>
                <p>
                  Yes. Plurilog is designed around a shared discussion. Models can receive the relevant conversation context, including contributions already made by other participants, allowing them to respond to, challenge or build on earlier reasoning.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-base sm:text-lg font-semibold text-zinc-900">
                  Does using several AI models make an answer automatically more accurate?
                </h3>
                <p>
                  No. Multiple perspectives can expose assumptions, disagreement and missing information, but agreement between AI models is not proof that a claim is correct. Important factual claims should still be checked against reliable sources.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-base sm:text-lg font-semibold text-zinc-900">
                  Why not just open ChatGPT, Claude and Gemini in separate tabs?
                </h3>
                <p>
                  You can, but the context quickly fragments. Each separate conversation develops its own history, files, clarifications and assumptions. Plurilog keeps the work centred around one continuing discussion instead.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-base sm:text-lg font-semibold text-zinc-900">
                  Does Plurilog support files and images?
                </h3>
                <p>
                  Yes. Files and images can be included in Plurilog discussions so that users can work with source material as part of the same ongoing AI conversation.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="text-base sm:text-lg font-semibold text-zinc-900">
                  Do I need separate ChatGPT, Claude and Gemini subscriptions?
                </h3>
                <p>
                  No. A Plurilog subscription provides access to the supported models through Plurilog; separate consumer subscriptions to each AI service are not required.
                </p>
              </div>
            </MotionReveal>

            {/* CTA Section */}
            <MotionReveal as="section" className="mt-12 p-8 sm:p-10 rounded-2xl bg-zinc-900 text-white text-center space-y-4 shadow-sm">
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                One conversation. Multiple perspectives. Better answers.
              </h3>
              <p className="text-sm sm:text-base text-zinc-300 max-w-xl mx-auto leading-relaxed">
                With Plurilog, ChatGPT, Claude and Gemini can respond inside the same discussion, see what the others have said, and challenge or build on each other&apos;s reasoning.
              </p>
              <div className="pt-2">
                <Link
                  href="/?signup=true"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 font-semibold text-sm transition-colors shadow-xs cursor-pointer"
                >
                  <span>Try Plurilog free</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </MotionReveal>
          </article>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="px-6 sm:px-12 py-6 border-t border-zinc-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <PlurilogMark className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span>Plurilog &copy; {new Date().getFullYear()}</span>
        </div>

        <div className="flex items-center gap-4 text-[11px]">
          <Link href="/privacy" className="hover:text-zinc-600 transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-zinc-600 transition-colors">Terms of Service</Link>
        </div>
      </footer>
    </div>
  );
}
