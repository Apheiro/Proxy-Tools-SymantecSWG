'use client';
import { ContextMenu as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        collisionPadding={8}
        className={cn(
          'z-50 min-w-48 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
export function ContextMenuItem({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof Primitive.Item> & {
  variant?: 'default' | 'destructive';
}) {
  return (
    <Primitive.Item
      data-variant={variant}
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        variant === 'destructive' &&
          'text-destructive focus:bg-destructive/10 focus:text-destructive',
        className,
      )}
      {...props}
    />
  );
}
