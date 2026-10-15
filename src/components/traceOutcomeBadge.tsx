import { Badge } from '@/components/ui/badge';
import { cva } from '@/lib/cva';
import type { TraceOutcome } from '@/lib/policyTrace';

const outcomeStyles = cva({
  variants: {
    verdict: {
      allowed:
        'border-green-600/25 bg-green-500/10 text-green-700 dark:text-green-400',
      rejected:
        'border-destructive/25 bg-destructive/10 text-destructive',
      exception:
        'border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      unknown: 'text-muted-foreground',
    },
  },
});

export default function TraceOutcomeBadge({
  outcome,
}: {
  outcome: TraceOutcome;
}) {
  return (
    <Badge
      variant='outline'
      className={outcomeStyles({ verdict: outcome.verdict })}
    >
      {outcome.label}
    </Badge>
  );
}
