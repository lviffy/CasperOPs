import '../lib/localStorage-polyfill'
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import Script from "next/script";

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
  title: "CasperOPs Agent Builder",
  description: "Build your own CasperOPs agents with ease.",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
        <link rel="icon" href="/logo.jpeg" type="image/jpeg" />
      </head>
      <body
        className={`${aeonik.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Script id="click-ui-options" strategy="beforeInteractive">
          {`window.clickUIOptions = { showTopBar: false, csprclickSdk: '/csprclick-sdk-1.11.js', rootAppElement: '#csprclick-navbar' };
            var clickUIOptions = window.clickUIOptions;
            window.clickSDKOptions = {
              appName: "CasperOPs",
              appId: "csprclick-template",
              providers: ["casper-wallet", "casper-signer", "ledger", "metamask-snap", "walletconnect"],
              chainName: "casper-test",
              casperNode: "https://rpc.testnet.casper.live/rpc",
              contentMode: "iframe"
            };
            var clickSDKOptions = window.clickSDKOptions;`}
        </Script>
        <Script id="csprclick-client" src="/csprclick-client-1.11.0.js" strategy="afterInteractive" />
        <div id="csprclick-navbar"></div>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}

