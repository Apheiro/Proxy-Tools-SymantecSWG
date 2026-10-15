'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import SshConsoleWorkspace from '@/components/sshConsoleWorkspace';

function ConsolePage() {
  const params = useSearchParams();
  return <SshConsoleWorkspace address={params.get('proxy') ?? ''} />;
}
export default function Page() {
  return (
    <Suspense
      fallback={<div className='p-6'>Loading SSH console…</div>}
    >
      <ConsolePage />
    </Suspense>
  );
}
