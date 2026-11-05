'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useTheme } from 'next-themes';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useComparisonZoomSlider } from '@/components/comparisonChartZoom';
import type { ComparisonSnapshot } from '@/lib/trafficComparison';
import {
  activityAxis,
  activityPoints,
  periodColor,
} from '@/lib/trafficComparisonPresentation';
import { formatBytes } from '@/lib/trafficAnalysis';
const Chart = dynamic(() => import('echarts-for-react'), {
  ssr: false,
});
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export default function ComparisonActivity({
  snapshot,
}: {
  snapshot: ComparisonSnapshot;
}) {
  const periods = snapshot.result.periods;
  const [visible, setVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(periods.map((p, i) => [p.label, i < 6])),
  );
  const [focus, setFocus] = useState('');
  const { resolvedTheme } = useTheme();
  const zoomSlider = useComparisonZoomSlider();
  const axis = activityAxis(snapshot);
  const text = resolvedTheme === 'dark' ? '#a8b3c4' : '#526071';
  const choose = (count: number) => {
    setFocus('');
    setVisible(
      Object.fromEntries(periods.map((p, i) => [p.label, i < count])),
    );
  };
  return (
    <Card className='min-w-0 gap-3 p-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-sm font-semibold'>
            Overlaid activity ·{' '}
            {snapshot.mode === 'hourly' ? 'minute' : '15-minute'}{' '}
            buckets
          </h2>
          <p className='mt-1 text-xs text-muted-foreground'>
            {snapshot.timeZone} ·{' '}
            {periods.filter((p) => visible[p.label]).length} /{' '}
            {periods.length} series visible
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => choose(periods.length)}
          >
            Show all
          </Button>
          <Button size='sm' variant='ghost' onClick={() => choose(6)}>
            First six
          </Button>
          <label className='sr-only' htmlFor='activity-focus'>
            Focus activity period
          </label>
          <select
            id='activity-focus'
            className='h-8 min-w-0 max-w-full rounded-md border bg-background px-2 text-xs'
            value={focus}
            onChange={(e) => {
              setFocus(e.target.value);
              if (!e.target.value) choose(6);
              else
                setVisible(
                  Object.fromEntries(
                    periods.map((p) => [
                      p.label,
                      p.id === e.target.value,
                    ]),
                  ),
                );
            }}
          >
            <option value=''>Focus a period…</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className='text-xs text-muted-foreground'>
        Toggle legend entries, focus a period or zoom to inspect
        activity.
      </p>
      <details className='text-xs text-muted-foreground'>
        <summary className='cursor-pointer'>
          Clock alignment, DST & gaps
        </summary>
        <p className='mt-2'>
          Hover points for local time, UTC offset and UTC timestamp.
          Repeated DST times remain separate points. Lines break at
          clock changes and unoccupied buckets; gaps do not prove
          missing logs. Daily and weekly buckets represent actual UTC
          intervals, displayed at their local start time.
        </p>
      </details>
      <Chart
        notMerge
        style={{ height: 340, width: '100%' }}
        onEvents={{
          legendselectchanged: (event: {
            selected: Record<string, boolean>;
          }) => {
            setVisible(event.selected);
            setFocus('');
          },
        }}
        option={{
          animation: false,
          aria: { enabled: true },
          backgroundColor: 'transparent',
          textStyle: { fontFamily: 'inherit', color: text },
          legend: {
            top: 0,
            left: 'center',
            type: 'scroll',
            selected: visible,
            textStyle: { color: text },
            pageTextStyle: { color: text },
          },
          grid: { left: 65, right: 20, top: 50, bottom: 75 },
          tooltip: {
            trigger: 'item',
            confine: true,
            formatter: (item: {
              seriesName: string;
              data: { observedAt?: string; value: [number, number] };
            }) =>
              `${escape(item.seriesName)}<br/>${escape(item.data.observedAt ?? '')}<br/>${escape(snapshot.metric === 'bytes' ? formatBytes(item.data.value[1]) : String(item.data.value[1]))} ${snapshot.metric === 'bytes' ? '' : 'requests'}`,
          },
          xAxis: {
            type: 'value',
            min: axis.min,
            max: axis.max,
            axisLabel: {
              formatter: axis.label,
              color: text,
              hideOverlap: true,
            },
            splitNumber: snapshot.mode === 'weekly' ? 7 : 6,
          },
          yAxis: {
            type: 'value',
            name: snapshot.metric,
            axisLabel: { color: text },
          },
          dataZoom: [
            { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
            zoomSlider,
          ],
          series: periods.map((p, i) => ({
            name: p.label,
            type: 'line',
            connectNulls: false,
            showSymbol: true,
            symbolSize: 5,
            emphasis: { focus: 'series' },
            itemStyle: { color: periodColor(i) },
            lineStyle: { width: 1.5 },
            data: activityPoints(p, snapshot),
          })),
        }}
      />
    </Card>
  );
}
