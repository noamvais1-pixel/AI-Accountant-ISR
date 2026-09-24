'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/** שורת טבלה שכולה קישור: לחיצה בכל מקום בשורה פותחת את היעד. */
export function LinkRow({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr
      onClick={(e) => {
        // לחיצה על קישור או כפתור בתוך השורה מתנהגת כרגיל
        if ((e.target as HTMLElement).closest('a,button')) return;
        router.push(href);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(href);
      }}
      tabIndex={0}
      role="link"
      className={`cursor-pointer ${className}`}
    >
      {children}
    </tr>
  );
}
