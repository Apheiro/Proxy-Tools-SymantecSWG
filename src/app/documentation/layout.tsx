import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import DocumentationNavigation from '@/components/documentationNavigation';

export const metadata: Metadata = {
  title: 'Documentation | Proxy Tools',
};
export default function DocumentationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className='mx-auto max-w-7xl px-4 py-6 md:px-8'>
      <header className='mb-6 flex items-center justify-between border-b pb-4'>
        <Link
          href='/documentation'
          className='flex items-center gap-2 font-semibold'
        >
          <BookOpen className='size-5 text-primary' />
          Proxy Tools documentation
        </Link>
        <Link
          href='/'
          className='text-sm text-muted-foreground hover:text-foreground'
        >
          Back to Home
        </Link>
      </header>
      <div className='grid items-start gap-8 lg:grid-cols-[210px_1fr]'>
        <DocumentationNavigation />
        <article className='min-w-0 pb-8'>{children}</article>
      </div>
    </main>
  );
}
