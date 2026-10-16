'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  WORKSPACE_STORAGE_KEY,
  workspacePath,
} from '@/lib/workspaces';

export default function Page() {
  const router = useRouter();
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    } catch {
      /* Use the default workspace if storage is unavailable. */
    }
    router.replace(workspacePath(saved));
  }, [router]);
  return (
    <output className='block p-6 text-sm text-muted-foreground'>
      Opening workspace…
    </output>
  );
}
