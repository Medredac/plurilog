import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

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
    default: "Your Own AI Panel with ChatGPT, Claude & Gemini | Plurilog",
    template: "%s | Plurilog",
  },
  description:
    "Bring ChatGPT, Claude and Gemini into one ongoing AI discussion with shared context and documents. Challenge AI errors and hallucinations with multiple perspectives.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Your Own AI Panel with ChatGPT, Claude & Gemini | Plurilog",
    description:
      "Bring ChatGPT, Claude and Gemini into one ongoing AI discussion with shared context and documents. Challenge AI errors and hallucinations with multiple perspectives.",
    url: "https://plurilogai.com/",
    siteName: "Plurilog",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Your Own AI Panel with ChatGPT, Claude & Gemini | Plurilog",
    description:
      "Bring ChatGPT, Claude and Gemini into one ongoing AI discussion with shared context and documents. Challenge AI errors and hallucinations with multiple perspectives.",
  },
  icons: {
    icon: "/logo.svg",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Plurilog",
  url: "https://plurilogai.com/",
  description:
    "Bring ChatGPT, Claude and Gemini into one ongoing AI discussion with shared context and documents. Challenge AI errors and hallucinations with multiple perspectives.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${poppins.variable}`}>
      <body className="min-h-full flex flex-col font-sans bg-[#FBF9F5] text-zinc-900">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
