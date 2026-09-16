import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // אפליקציית המק בונה לתיקייה נפרדת, כדי לא להתנגש בשרת הפיתוח.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // יש package-lock.json גם בתיקיית הבית; בלי זה Next בוחר אותה כשורש הפרויקט.
  outputFileTracingRoot: import.meta.dirname,
  experimental: {
    serverActions: { bodySizeLimit: '15mb' },
  },
};

export default nextConfig;
