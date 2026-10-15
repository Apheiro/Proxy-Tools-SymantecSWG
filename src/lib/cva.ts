import { defineConfig } from 'cva/config';
import { cn } from '@/lib/utils';

export type { VariantProps } from 'cva';

// Keep variant classes and consumer overrides consistent with the app's Tailwind merge rules.
export const { cva } = defineConfig({ cx: cn });
