import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { SignupSourceTracker } from "@/components/SignupSourceTracker";
import { PostHogProvider } from "@/components/PostHogProvider";
import { MetaPixelProvider } from "@/components/MetaPixelProvider";
import { GoogleAdsProvider } from "@/components/GoogleAdsProvider";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://plurilogai.com"),
  title: {
    default: "AI Group Chat: ChatGPT, Claude & Gemini | Plurilog",
    template: "%s | Plurilog",
  },
  description:
    "Put ChatGPT, Claude and Gemini in one AI group chat. Compare AI models as they read, respond to and challenge each other in one shared discussion.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "AI Group Chat: ChatGPT, Claude & Gemini | Plurilog",
    description:
      "Put ChatGPT, Claude and Gemini in one AI group chat. Compare AI models as they read, respond to and challenge each other in one shared discussion.",
    url: "https://plurilogai.com/",
    siteName: "Plurilog",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://plurilogai.com/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Plurilog — AI group chat with ChatGPT, Claude and Gemini",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Group Chat: ChatGPT, Claude & Gemini | Plurilog",
    description:
      "Put ChatGPT, Claude and Gemini in one AI group chat. Compare AI models as they read, respond to and challenge each other in one shared discussion.",
    images: ["https://plurilogai.com/twitter-image.png"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://plurilogai.com/#website",
      name: "Plurilog",
      alternateName: "Plurilog AI",
      url: "https://plurilogai.com/",
      description:
        "Put ChatGPT, Claude and Gemini in one AI group chat. Compare AI models as they read, respond to and challenge each other in one shared discussion.",
      publisher: {
        "@id": "https://plurilogai.com/#organization",
      },
    },
    {
      "@type": "Organization",
      "@id": "https://plurilogai.com/#organization",
      name: "Plurilog",
      alternateName: "Plurilog AI",
      url: "https://plurilogai.com/",
      logo: {
        "@type": "ImageObject",
        url: "https://plurilogai.com/plurilog-icon-512.png",
        contentUrl: "https://plurilogai.com/plurilog-icon-512.png",
        width: 512,
        height: 512,
      },
    },
    {
      "@type": "WebApplication",
      "@id": "https://plurilogai.com/#app",
      name: "Plurilog",
      alternateName: "Plurilog AI",
      url: "https://plurilogai.com/",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript and a modern web browser.",
      description:
        "An AI group chat and multi-model workspace that brings ChatGPT, Claude and Gemini into one shared discussion where models can read and respond to earlier answers, with persistent context, file and image analysis, document creation and editing, image generation, web search and voice dictation.",
      image: "https://plurilogai.com/opengraph-image.png",
      publisher: {
        "@id": "https://plurilogai.com/#organization",
      },
      featureList: [
        "AI group chat with ChatGPT, Claude and Gemini",
        "Compare AI models through one shared discussion",
        "Persistent shared conversation context",
        "PDF, DOCX, image and text-file analysis",
        "Creation of downloadable Word documents and PDFs",
        "Editing of existing Word documents and PDFs",
        "ChatGPT and Gemini image generation and editing",
        "Preview and download of SVG artwork",
        "Web search for current information",
        "Voice dictation",
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${poppins.variable}`}>
      <body className="min-h-full flex flex-col font-sans bg-[#FBF9F5] text-zinc-900">
        <PostHogProvider />
        <MetaPixelProvider />
        <GoogleAdsProvider />
        <SignupSourceTracker />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
