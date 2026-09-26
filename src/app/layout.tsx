import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { SignupSourceTracker } from "@/components/SignupSourceTracker";
import { PostHogProvider } from "@/components/PostHogProvider";
import { MetaPixelProvider } from "@/components/MetaPixelProvider";

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
    default: "ChatGPT, Claude & Gemini in One Conversation | Plurilog",
    template: "%s | Plurilog",
  },
  description:
    "Use ChatGPT, Claude and Gemini in one shared conversation. Compare answers, analyse files, create and edit Word and PDF documents, generate images and search the web.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "ChatGPT, Claude & Gemini in One Conversation | Plurilog",
    description:
      "Use ChatGPT, Claude and Gemini in one shared conversation. Compare answers, analyse files, create and edit Word and PDF documents, generate images and search the web.",
    url: "https://plurilogai.com/",
    siteName: "Plurilog",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://plurilogai.com/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Plurilog — ChatGPT, Claude and Gemini in one conversation",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Plurilog - Your Own AI Panel",
    description:
      "Use ChatGPT, Claude and Gemini in one shared conversation. Compare answers, analyse files, create and edit Word and PDF documents, generate images and search the web.",
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
        "Use ChatGPT, Claude and Gemini in one shared conversation. Compare answers, analyse files, create and edit Word and PDF documents, generate images and search the web.",
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
        "A multi-AI workspace that brings ChatGPT, Claude and Gemini into one shared conversation with persistent context, file and image analysis, Word and PDF creation and editing, image generation and editing, SVG output, web search and voice dictation.",
      image: "https://plurilogai.com/opengraph-image.png",
      publisher: {
        "@id": "https://plurilogai.com/#organization",
      },
      featureList: [
        "ChatGPT, Claude and Gemini in one shared conversation",
        "Cross-model comparison and discussion",
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
