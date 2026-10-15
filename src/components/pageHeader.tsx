import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps
  extends Omit<
    ComponentPropsWithoutRef<'header'>,
    'title' | 'children'
  > {
  icon?: LucideIcon;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/** Shared workspace heading; each screen supplies its own action controls. */
export default function PageHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      data-slot='page-header'
      className={cn(
        'flex shrink-0 flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between',
        className,
      )}
      {...props}
    >
      <div className='min-w-0 space-y-2'>
        {(Icon || eyebrow) && (
          <div
            data-slot='page-header-eyebrow'
            className='flex items-center gap-2 text-sm text-muted-foreground'
          >
            {Icon && (
              <Icon aria-hidden='true' className='size-4 shrink-0' />
            )}
            {eyebrow}
          </div>
        )}
        <h1 className='break-words text-2xl font-bold tracking-tight md:text-3xl'>
          {title}
        </h1>
        {description && (
          <p className='max-w-2xl break-words text-sm text-muted-foreground'>
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div
          data-slot='page-header-actions'
          className='flex min-w-0 shrink-0 flex-wrap items-center gap-2 md:justify-end'
        >
          {actions}
        </div>
      )}
    </header>
  );
}
