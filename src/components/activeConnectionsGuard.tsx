'use client';
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import useDataSourceMode from '@/lib/useDataSourceMode';

/** Keep backend captures scoped even when navigating away from the workspace. */
export default function ActiveConnectionsGuard() {
  const { mode, ready } = useDataSourceMode();
  useEffect(() => {
    if (!ready) return;
    void invoke('ac_guard', { profile: mode }).catch(
      (reason) => {
        // Never suppress a scope-stop failure silently; no credentials in this error.
        console.error(
          'Active Connections scope guard failed:',
          reason,
        );
      },
    );
  }, [mode, ready]);
  return null;
}
