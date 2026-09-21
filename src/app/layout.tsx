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
    default: "Plurilog - Your Own AI Panel",
    template: "%s | Plurilog",
  },
  description:
    "Bring ChatGPT, Claude and Gemini into one ongoing AI discussion with shared context and documents. Challenge AI errors and hallucinations with multiple perspectives.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Plurilog - Your Own AI Panel",
    description:
      "Bring ChatGPT, Claude and Gemini into one ongoing AI discussion with shared context and documents. Challenge AI errors and hallucinations with multiple perspectives.",
    url: "https://plurilogai.com/",
    siteName: "Plurilog",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Plurilog - Your Own AI Panel",
    description:
      "Bring ChatGPT, Claude and Gemini into one ongoing AI discussion with shared context and documents. Challenge AI errors and hallucinations with multiple perspectives.",
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
        "Bring ChatGPT, Claude and Gemini into one ongoing AI discussion with shared context and documents. Challenge AI errors and hallucinations with multiple perspectives.",
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
      applicationCategory: "ProductivityApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript and a modern web browser.",
      description:
        "A multi-AI panel that brings ChatGPT, Claude and Gemini into one shared conversation with persistent context, document and image analysis, and supported image generation and editing.",
      image: "https://plurilogai.com/opengraph-image.png",
      publisher: {
        "@id": "https://plurilogai.com/#organization",
      },
      featureList: [
        "ChatGPT, Claude and Gemini in one shared conversation",
        "Cross-model comparison and discussion",
        "Persistent shared conversation context",
        "PDF, DOCX, image and text-file analysis",
        "ChatGPT and Gemini image generation and editing",
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
