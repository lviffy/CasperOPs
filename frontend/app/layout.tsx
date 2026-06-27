import '../lib/localStorage-polyfill'
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CasperOPs Agent Builder",
  description: "Build your own CasperOPs agents with ease.",
  icons: {
    icon: "/casperops-logo.png",
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
        <link rel="icon" href="/casperops-logo.png" type="image/png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
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

