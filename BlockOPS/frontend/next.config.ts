import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Polyfill localStorage for server-side rendering
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'node-localstorage': false,
      };
    }
    return config;
  },
  // Disable server components for pages using wallet SDKs
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
