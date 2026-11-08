'use client';

import { createContext, useContext, useEffect } from 'react';

export const DiagnosticsVisibilityContext = createContext(true);
export const useDiagnosticsVisible = () => useContext(DiagnosticsVisibilityContext);

export type DiagnosticsTask = {
  id: string;
  proxy: string;
  route: string;
  status: string;
};
export const DiagnosticsTasksContext = createContext<
  (id: string, task: DiagnosticsTask | null) => void
>(() => {});

/** Report actual work only; this registry never owns credentials or starts jobs. */
export function useDiagnosticsTask(proxy: string, workspace: 'TrafficAnalysis' | 'ComparativeReports', status: string | null) {
  const report = useContext(DiagnosticsTasksContext);
  useEffect(() => {
    const id = `${workspace}:${proxy}`;
    report(id, status ? { id, proxy, route: `/Diagnostics/${workspace}`, status } : null);
    return () => report(id, null);
  }, [report, proxy, workspace, status]);
}
