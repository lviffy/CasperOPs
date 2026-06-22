import '../lib/localStorage-polyfill'
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const aeonik = localFont({
  src: [
    {
      path: "./fonts/AeonikTRIAL-Light.otf",
      weight: "300",
      style: "normal",
    },
    {
      path: "./fonts/AeonikTRIAL-LightItalic.otf",
      weight: "300",
      style: "italic",
    },
    {
      path: "./fonts/AeonikTRIAL-Regular.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/AeonikTRIAL-RegularItalic.otf",
      weight: "400",
      style: "italic",
    },
    {
      path: "./fonts/AeonikTRIAL-Bold.otf",
      weight: "700",
      style: "normal",
    },
    {
      path: "./fonts/AeonikTRIAL-BoldItalic.otf",
      weight: "700",
      style: "italic",
    },
  ],
  variable: "--font-aeonik",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["monospace"],
});

export const metadata: Metadata = {
  title: "BlockOps Agent Builder",
  description: "Build your own BlockOps agents with ease.",
  icons: {
    icon: "/logo.jpeg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
        <link rel="icon" href="/logo.jpeg" type="image/jpeg" />
      </head>
      <body
        className={`${aeonik.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
