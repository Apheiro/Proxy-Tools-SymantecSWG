'use client';
import { FileCode2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import PacFileManagerWorkspace from '@/components/pacFileManagerWorkspace';
import PageHeader from '@/components/pageHeader';
import { getLocalStorage } from '@/lib/utilsClient';

function PacWorkspacePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Preserve links created before the source editor had its own route.
    const query = new URLSearchParams(searchParams.toString());
    if (query.get('new') === '1' || query.has('sourceId')) {
      router.replace(`/pac/editor?${query.toString()}`);
      return;
    }
    setProxies(getLocalStorage<Proxy[]>('proxies') ?? []);
    setReady(true);
  }, [router, searchParams]);
  if (!ready)
    return (
      <p className='text-sm text-muted-foreground'>
        Opening PAC Manager…
      </p>
    );
  return (
    <main className='flex min-w-0 flex-col gap-6'>
      <PageHeader
        icon={FileCode2}
        eyebrow='PAC/WPAD file workspace'
        title='PAC File Manager Workspace'
        description='Manage PAC sources here. Open an existing source or create one from scratch to edit routing rules in its dedicated workspace. Proxy destinations use the registered inventory.'
      />
      <PacFileManagerWorkspace proxies={proxies} />
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p>Opening PAC Manager…</p>}>
      <PacWorkspacePage />
    </Suspense>
  );
}
