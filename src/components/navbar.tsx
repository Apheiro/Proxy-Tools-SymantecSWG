/** biome-ignore-all lint/performance/noImgElement: <> */
// 'use client';
// import Link from 'next/link';
// import { useSearchParams } from 'next/navigation';
// import { useEffect, useState } from 'react';
// import { getLocalStorage } from '@/lib/utilsClient';
// import ConfigMenu from './configmenu';
// import { Button } from './ui/button';

// export default function Navbar() {
//   const [lastProxy, setLastProxy] = useState<{
//     hostname: string;
//     ip: string;
//   } | null>(null);
//   const searchParams = useSearchParams();

//   useEffect(() => {
//     const proxy = getLocalStorage<Proxy[]>('proxies')?.filter(
//       (p: Proxy) => p.hostinfo.ip === searchParams.get('proxy'),
//     )?.[0];
//     if (!proxy) return;
//     setLastProxy({ hostname: proxy.hostname, ip: proxy.hostinfo.ip });
//   }, [searchParams]);

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

/** biome-ignore-all lint/performance/noImgElement: <> */
'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { getLocalStorage } from '@/lib/utilsClient';
import ConfigMenu from './configmenu';
import { Button } from './ui/button';

export default function Navbar() {
  return (
    <Suspense fallback={<NavSkeleton />}>
      <NavbarInner />
    </Suspense>
  );
}

function NavbarInner() {
  const [lastProxy, setLastProxy] = useState<{
    hostname: string;
    ip: string;
  } | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const proxy = getLocalStorage<Proxy[]>('proxies')?.find(
      (p: Proxy) => p.hostinfo.ip === searchParams.get('proxy'),
    );
    if (proxy)
      setLastProxy({
        hostname: proxy.hostname,
        ip: proxy.hostinfo.ip,
      });
  }, [searchParams]); // si quieres evitar renders, usa [searchParams.toString()]

  return (
    <div className='flex items-center gap-2 p-2'>
      <Button variant='ghost' size='sm'>
        <Link href='/'>Home</Link>
      </Button>
      <Button variant='ghost' size='sm' disabled={!lastProxy}>
        <Link
          href={{
            pathname: '/trace',
            query: { proxy: lastProxy?.ip },
          }}
        >
          Trace {lastProxy?.hostname}
        </Link>
      </Button>
      <ConfigMenu className='ml-auto' />
    </div>
  );
}

function NavSkeleton() {
  return <div className='h-9 w-full' />; // placeholder simple
}
