import type { ReactNode } from 'react';
import WorkspaceNavigation from '@/components/workspaceNavigation';

export default function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className='mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6'>
      <WorkspaceNavigation />
      {children}
    </div>
  );
}
