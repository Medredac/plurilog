import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Plurilog · The AI Council Debate",
  description: "Watch GPT-4o, Claude 3.5, and Gemini 1.5 convene, debate, and synthesize answers to your deepest & silliest questions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${poppins.variable}`}>
      <body className="min-h-full flex flex-col font-sans bg-[#FBF9F5] text-zinc-900">
        {children}
      </body>
    </html>
  );
}
