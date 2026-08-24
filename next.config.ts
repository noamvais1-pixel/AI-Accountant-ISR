import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // יש package-lock.json גם בתיקיית הבית; בלי זה Next בוחר אותה כשורש הפרויקט.
  outputFileTracingRoot: import.meta.dirname,
  experimental: {
    serverActions: { bodySizeLimit: '15mb' },
  },
};

export default nextConfig;
