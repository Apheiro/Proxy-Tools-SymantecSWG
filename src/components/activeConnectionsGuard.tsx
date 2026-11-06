'use client';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import useDataSourceMode from '@/lib/useDataSourceMode';

/** Keep backend captures scoped even when navigating away from the workspace. */
export default function ActiveConnectionsGuard() {
  const params = useSearchParams();
  const proxy = params.get('proxy');
  const { mode, ready } = useDataSourceMode();
  useEffect(() => {
    if (!ready) return;
    void invoke('ac_guard', { profile: mode, proxy }).catch(
      (reason) => {
        // Never suppress a scope-stop failure silently; no credentials in this error.
        console.error(
          'Active Connections scope guard failed:',
          reason,
        );
      },
    );
  }, [mode, ready, proxy]);
  return null;
}
