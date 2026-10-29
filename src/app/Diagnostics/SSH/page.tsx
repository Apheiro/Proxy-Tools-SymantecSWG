'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import SshConsoleWorkspace from '@/components/sshConsoleWorkspace';

function ConsolePage() {
  const params = useSearchParams();
  const isg = params.get('target') === 'isg';
  return (
    <SshConsoleWorkspace
      key={`${isg ? 'isg' : 'proxy'}:${isg ? params.get('host') : params.get('proxy')}`}
      address={(isg ? params.get('host') : params.get('proxy')) ?? ''}
      targetKind={isg ? 'isg' : 'proxy'}
      applianceName={
        isg ? (params.get('name') ?? undefined) : undefined
      }
    />
  );
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
