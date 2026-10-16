import { FileCode2, Network, ShieldCheck } from 'lucide-react';

export const WORKSPACE_STORAGE_KEY = 'home-workspace';
export const WORKSPACES = [
  {
    id: 'proxy',
    href: '/proxies',
    label: 'Proxy Workspace',
    icon: Network,
  },
  {
    id: 'pac',
    href: '/pac',
    label: 'PAC File Manager',
    icon: FileCode2,
  },
  {
    id: 'policy',
    href: '/policy',
    label: 'Local Policy Manager',
    icon: ShieldCheck,
  },
] as const;

export function workspacePath(saved: string | null) {
  return (
    WORKSPACES.find((workspace) => workspace.id === saved)?.href ??
    '/proxies'
  );
}
export function workspaceForPath(pathname: string) {
  return WORKSPACES.find(
    (workspace) =>
      pathname === workspace.href ||
      pathname.startsWith(`${workspace.href}/`),
  );
}
