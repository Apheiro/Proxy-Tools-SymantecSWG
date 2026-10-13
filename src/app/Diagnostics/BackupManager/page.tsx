'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import BackupManagerWorkspace from '@/components/backupManagerWorkspace';

function BackupManagerPage() {
  const params = useSearchParams();
  return (
    <BackupManagerWorkspace address={params.get('proxy') ?? ''} />
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={<div className='p-6'>Loading Backup Manager…</div>}
    >
      <BackupManagerPage />
    </Suspense>
  );
}
