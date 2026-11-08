'use client';

import { invoke } from '@tauri-apps/api/core';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { DiagnosticsTasksContext, DiagnosticsVisibilityContext, type DiagnosticsTask } from './diagnosticsTasks';
import { TooltipOne } from './ui/tooltip';
import useDataSourceMode from '@/lib/useDataSourceMode';
import { pollingLabel } from '@/lib/activeConnections';

const ActiveConnectionsWorkspace = dynamic(() => import('./activeConnectionsWorkspace'));
const TrafficAnalysisWorkspace = dynamic(() => import('./trafficAnalysisWorkspace'));
const ComparativeReportsWorkspace = dynamic(() => import('./comparativeReportsWorkspace'));

const workspaces = {
  '/Diagnostics/ActiveConnections': ActiveConnectionsWorkspace,
  '/Diagnostics/TrafficAnalysis': TrafficAnalysisWorkspace,
  '/Diagnostics/ComparativeReports': ComparativeReportsWorkspace,
};
type WorkspaceRoute = keyof typeof workspaces;
type Entry = { id: string; route: WorkspaceRoute; proxy: string };

/** App-lifetime ownership keeps page effects alive across route/proxy navigation.
 * Profile switches deliberately unmount the host, cancelling incompatible work.
 * Hidden workspaces retain their state but are excluded from focus/accessibility.
 */
export default function DiagnosticsHost({ children }: { children: ReactNode }) {
  const { mode, ready } = useDataSourceMode();
  return ready ? <ProfileHost key={mode} profile={mode}>{children}</ProfileHost> : <>{children}</>;
}

function ProfileHost({ profile, children }: { profile: 'live' | 'mock'; children: ReactNode }) {
  const pathname = usePathname();
  const proxy = useSearchParams().get('proxy') ?? '';
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tasks, setTasks] = useState<Record<string, DiagnosticsTask>>({});
  const [connections, setConnections] = useState<DiagnosticsTask[]>([]);
  const [inventory, setInventory] = useState<Proxy[]>([]);
  const [dockError, setDockError] = useState('');
  const route = Object.prototype.hasOwnProperty.call(workspaces, pathname) ? pathname as WorkspaceRoute : null;
  const selectedId = route ? `${route}:${proxy}` : '';
  useEffect(() => {
    if (route) setEntries((old) => old.some((entry) => entry.id === selectedId) ? old : [...old, { id: selectedId, route, proxy }]);
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(frame);
  }, [route, proxy, selectedId]);
  const report = useCallback((id: string, task: DiagnosticsTask | null) => {
    setTasks((old) => {
      const next = { ...old };
      if (task) next[id] = task;
      else delete next[id];
      return next;
    });
  }, []);
  useEffect(() => {
    const read = () => {
      try {
        const value = JSON.parse(localStorage.getItem('proxies') ?? '[]');
        setInventory(Array.isArray(value) ? value : []);
      } catch { setInventory([]); }
    };
    read();
    window.addEventListener('storage', read);
    window.addEventListener('focus', read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener('focus', read); };
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const running = await invoke<Array<{ proxy: string; status: string; interval: number }>>('ac_list_running', { profile });
        if (alive) {
          setDockError('');
          setConnections(running.map((task) => ({
            id: `ActiveConnections:${task.proxy}`, proxy: task.proxy,
            route: '/Diagnostics/ActiveConnections',
            status: `Active Connections ${task.status === 'Backoff' ? 'waiting to retry' : 'collecting'} · ${pollingLabel(task.interval)}`,
          })));
        }
      } catch {
        if (alive) { setConnections([]); setDockError('Background monitor status unavailable'); }
      }
      if (alive) timer = setTimeout(read, 1000);
    };
    void read();
    return () => { alive = false; clearTimeout(timer); };
  }, [profile]);
  const allTasks = [...connections, ...Object.values(tasks)];
  return (
    <DiagnosticsTasksContext.Provider value={report}>
      {route ? null : children}
      {entries.map((entry) => {
        const Workspace = workspaces[entry.route];
        return <div key={entry.id} hidden={entry.id !== selectedId}><DiagnosticsVisibilityContext.Provider value={entry.id === selectedId}><Workspace proxy={entry.proxy} /></DiagnosticsVisibilityContext.Provider></div>;
      })}
      {(allTasks.length > 0 || dockError) && (
        <nav aria-label='Background diagnostic tasks' className='fixed bottom-20 left-4 z-[64] flex max-h-40 max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 overflow-auto rounded-2xl border bg-card/95 p-2 shadow-sm backdrop-blur'>
          {dockError && <span role='status' className='max-w-48 text-xs text-muted-foreground'>{dockError}</span>}
          {allTasks.map((task) => {
            const item = inventory.find((p) => p?.hostinfo?.ip === task.proxy || p?.primary_address === task.proxy || p?.registered_address === task.proxy);
            const label = `${item?.hostname || task.proxy} · ${task.status}`;
            return <TooltipOne key={task.id} content={label} classNameContent='max-w-80'>
              <Link href={{ pathname: task.route, query: { proxy: task.proxy } }} aria-label={label} className='flex size-8 items-center justify-center rounded-full border bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
                <span aria-hidden='true' className='size-2.5 rounded-full bg-primary motion-safe:animate-pulse' />
              </Link>
            </TooltipOne>;
          })}
        </nav>
      )}
    </DiagnosticsTasksContext.Provider>
  );
}
