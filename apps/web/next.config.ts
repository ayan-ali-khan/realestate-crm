import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Property photos come from Cloudinary (uploads) or the seed
  // (picsum.photos — Unsplash stays listed for hand-added URLs). next/image
  // only optimizes allowlisted hosts, and an unlisted host throws at runtime,
  // so keep this list in sync with whatever the API can return.
  images: {
    remotePatterns: [
      { hostname: 'res.cloudinary.com' },
      { hostname: 'picsum.photos' },
      { hostname: 'images.unsplash.com' },
    ],
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
