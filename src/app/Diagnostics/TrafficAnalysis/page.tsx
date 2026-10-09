'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import TrafficAnalysisWorkspace from '@/components/trafficAnalysisWorkspace';

function CaptureContext() {
  const params = useSearchParams();
  return (
    <TrafficAnalysisWorkspace proxy={params.get('proxy') ?? ''} />
  );
}
export default function Page() {
  return (
    <Suspense
      fallback={
        <main className='p-8 text-muted-foreground'>
          Loading Traffic Analysis…
        </main>
      }
    >
      <CaptureContext />
    </Suspense>
  );
}
