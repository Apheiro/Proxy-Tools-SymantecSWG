import { cva } from '@/lib/cva';

export const refreshStyles = cva({
  base: 'transition-opacity duration-500',
  variants: {
    refreshing: {
      true: 'opacity-[0.96]',
      false: 'opacity-100',
    },
  },
  defaultVariants: { refreshing: false },
});

export const disclosureIconStyles = cva({
  base: 'transition-transform',
  variants: { expanded: { true: 'rotate-180', false: '' } },
  defaultVariants: { expanded: false },
});
