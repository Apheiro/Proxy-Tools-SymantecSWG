// /** biome-ignore-all lint/performance/noImgElement: <> */
// // 'use client';
// // import Link from 'next/link';
// // import { useSearchParams } from 'next/navigation';
// // import { useEffect, useState } from 'react';
// // import { getLocalStorage } from '@/lib/utilsClient';
// // import ConfigMenu from './configmenu';
// // import { Button } from './ui/button';

// // export default function Navbar() {
// //   const [lastProxy, setLastProxy] = useState<{
// //     hostname: string;
// //     ip: string;
// //   } | null>(null);
// //   const searchParams = useSearchParams();

// //   useEffect(() => {
// //     const proxy = getLocalStorage<Proxy[]>('proxies')?.filter(
// //       (p: Proxy) => p.hostinfo.ip === searchParams.get('proxy'),
// //     )?.[0];
// //     if (!proxy) return;
// //     setLastProxy({ hostname: proxy.hostname, ip: proxy.hostinfo.ip });
// //   }, [searchParams]);

// //   return (
// //     <div className='flex items-center gap-2 p-2'>
// //       <Button variant='ghost' size='sm'>
// //         <Link href='/'>Home</Link>
// //       </Button>
// //       <Button variant='ghost' size='sm' disabled={!lastProxy}>
// //         <Link
// //           href={{
// //             pathname: '/trace',
// //             query: { proxy: lastProxy?.ip },
// //           }}
// //         >
// //           Trace {lastProxy?.hostname}
// //         </Link>
// //       </Button>
// //       <ConfigMenu className='ml-auto' />
// //     </div>
// //   );
// // }

// /** biome-ignore-all lint/performance/noImgElement: <> */
// 'use client';
// import Link from 'next/link';
// import { useSearchParams } from 'next/navigation';
// import { Suspense, useEffect, useState } from 'react';
// import { getLocalStorage } from '@/lib/utilsClient';
// import ConfigMenu from './configmenu';
// import { Button } from './ui/button';

// export default function Navbar() {
//   return (
//     <Suspense fallback={<NavSkeleton />}>
//       <NavbarInner />
//     </Suspense>
//   );
// }

// function NavbarInner() {
//   const [lastProxy, setLastProxy] = useState<{
//     hostname: string;
//     ip: string;
//   } | null>(null);
//   const searchParams = useSearchParams();

//   useEffect(() => {
//     const proxy = getLocalStorage<Proxy[]>('proxies')?.find(
//       (p: Proxy) => p.hostinfo.ip === searchParams.get('proxy'),
//     );
//     if (proxy)
//       setLastProxy({
//         hostname: proxy.hostname,
//         ip: proxy.hostinfo.ip,
//       });
//   }, [searchParams]); // si quieres evitar renders, usa [searchParams.toString()]

//   return (
//     <div className='flex items-center gap-2 p-2'>
//       <Button variant='ghost' size='sm'>
//         <Link href='/'>Home</Link>
//       </Button>
//       <Button variant='ghost' size='sm' disabled={!lastProxy}>
//         <Link
//           href={{
//             pathname: '/trace',
//             query: { proxy: lastProxy?.ip },
//           }}
//         >
//           Trace {lastProxy?.hostname}
//         </Link>
//       </Button>
//       <ConfigMenu className='ml-auto' />
//     </div>
//   );
// }

// function NavSkeleton() {
//   return <div className='h-9 w-full' />; // placeholder simple
// }

'use client';

import { BookOpen, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import ConfigMenu from './configmenu';

const LABELS: Record<string, string> = {
  trace: 'Trace',
  config: 'Config',
  settings: 'Settings',
  documentation: 'Documentation',
  another: 'Another',
};

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  const segments = pathname.split('/').filter(Boolean);

  const breadcrumbs = [
    {
      label: 'Home',
      href: '/',
    },
    ...segments.map((segment, index) => ({
      label:
        LABELS[segment] ??
        segment
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      href: `/${segments.slice(0, index + 1).join('/')}`,
    })),
  ];

  return (
    <nav className='flex shrink-0 items-center gap-3 border-b px-4 py-2'>
      <Button
        variant='ghost'
        size='icon'
        onClick={() => router.back()}
        aria-label='Go back'
        disabled={segments.length === 0}
      >
        <ChevronLeft className='h-5 w-5' />
      </Button>
      <div className='flex items-center gap-1 text-sm'>
        {breadcrumbs.map((crumb, index) => (
          <div key={crumb.href} className='flex items-center gap-1'>
            {index > 0 && (
              <span className='text-muted-foreground'>/</span>
            )}

            {index === breadcrumbs.length - 1 ? (
              <span className='font-medium'>{crumb.label}</span>
            ) : (
              <Link
                href={crumb.href}
                className='text-muted-foreground hover:text-foreground transition-colors'
              >
                {crumb.label}
              </Link>
            )}
          </div>
        ))}
      </div>
      <div className='ml-auto flex items-center gap-1'>
        <Button asChild variant='ghost' size='icon'>
          <Link
            href='/documentation'
            aria-label='Open documentation'
            title='Documentation'
          >
            <BookOpen className='size-4' />
          </Link>
        </Button>
        <ConfigMenu />
      </div>
    </nav>
  );
}
