'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ActiveConnectionsWorkspace from '@/components/activeConnectionsWorkspace';
function Context() {
  const params = useSearchParams();
  return (
    <ActiveConnectionsWorkspace proxy={params.get('proxy') ?? ''} />
  );
}
export default function Page() {
  return (
    <Suspense
      fallback={
        <main className='p-8'>Loading Active Connections…</main>
      }
    >
      <Context />
    </Suspense>
  );
}
