'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  WORKSPACE_STORAGE_KEY,
  WORKSPACES,
  workspaceForPath,
} from '@/lib/workspaces';

export default function WorkspaceNavigation() {
  const active = workspaceForPath(usePathname());
  useEffect(() => {
    if (active) {
      try {
        localStorage.setItem(WORKSPACE_STORAGE_KEY, active.id);
      } catch {
        /* Navigation still works without persistent storage. */
      }
    }
  }, [active]);
  return (
    <nav
      aria-label='Select workspace'
      className='flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border bg-muted/50 p-1'
    >
      {WORKSPACES.map((workspace) => (
        <Button
          key={workspace.id}
          asChild
          size='sm'
          variant={active?.id === workspace.id ? 'default' : 'ghost'}
        >
          <Link
            href={workspace.href}
            aria-current={
              active?.id === workspace.id ? 'page' : undefined
            }
          >
            <workspace.icon className='size-4' />
            {workspace.label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
