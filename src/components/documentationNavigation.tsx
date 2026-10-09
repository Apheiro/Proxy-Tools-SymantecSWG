'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const documentationLinks = [
  ['', 'Overview'],
  ['proxies', 'Home & proxies'],
  ['diagnostics', 'Diagnostics'],
  ['trace', 'Trace'],
  ['traffic-analysis', 'Traffic Analysis'],
  ['pac', 'PAC File Manager'],
  ['settings', 'Settings & connections'],
  ['storage', 'Files & local storage'],
] as const;

export default function DocumentationNavigation() {
  const path = usePathname();
  return (
    <nav
      aria-label='Documentation sections'
      className='flex flex-wrap gap-1 lg:sticky lg:top-6 lg:flex-col'
    >
      {documentationLinks.map(([slug, label]) => {
        const href = `/documentation${slug ? `/${slug}` : ''}`;
        return (
          <Link
            key={href}
            href={href}
            aria-current={path === href ? 'page' : undefined}
            className={`rounded-md px-3 py-2 text-sm ${path === href ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
