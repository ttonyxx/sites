import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Nunito } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Rounded heavy face for the letter tiles, close to the real thing.
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Pirates Blitz — anagram steal trainer",
    template: "%s · Pirates Blitz",
  },
  description:
    "Train the one skill that wins at Pirates: spotting steals. Combine words and loose letters into new words against the clock.",
  applicationName: "Pirates Blitz",
  openGraph: {
    title: "Pirates Blitz",
    description: "An arcade trainer for the anagram-stealing word game Pirates.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${nunito.variable} h-full antialiased`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
