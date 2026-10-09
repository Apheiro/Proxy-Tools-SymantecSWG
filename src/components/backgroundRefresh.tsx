'use client';
import { LoaderCircle } from 'lucide-react';

export default function BackgroundRefresh({
  active,
  label = 'Updating data…',
}: {
  active: boolean;
  label?: string;
}) {
  if (!active) return null;
  return (
    <output
      aria-live='polite'
      className='fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm pointer-events-none'
    >
      <LoaderCircle className='size-3.5 animate-spin' />
      {label}
    </output>
  );
}
