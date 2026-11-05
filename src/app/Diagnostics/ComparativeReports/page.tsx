'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ComparativeReportsWorkspace from '@/components/comparativeReportsWorkspace';
function Context() {
  const params = useSearchParams();
  return (
    <ComparativeReportsWorkspace proxy={params.get('proxy') ?? ''} />
  );
}
export default function Page() {
  return (
    <Suspense
      fallback={
        <main className='p-8 text-muted-foreground'>
          Loading Comparative Reports…
        </main>
      }
    >
      <Context />
    </Suspense>
  );
}
