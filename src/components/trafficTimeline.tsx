'use client';

import { BarChart, HeatmapChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';
import {
  createTrafficTimeFormatter,
  formatBytes,
  type TrafficDataset,
} from '@/lib/trafficAnalysis';
import type { CaptureRange } from '@/lib/trafficCapture';

echarts.use([
  BarChart,
  HeatmapChart,
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);
const ReactECharts = dynamic(
  () => import('echarts-for-react/lib/core'),
  { ssr: false },
);
const chartOptions = { renderer: 'canvas' as const };
const COLUMN_GAP = 4;
const COLUMN_MIN_WIDTH = 3;
const COLUMN_GRID_LEFT = 68;
const COLUMN_GRID_RIGHT = 12;
const DENSITY_COLORS = ['#dddddd', '#ffff00', '#8b0000'];

// Resolve the application's CSS tokens to RGB for ECharts' canvas and color utilities.
function chartPalette(dark: boolean) {
  const styles = getComputedStyle(document.documentElement);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  const resolve = (token: string, fallback: string) => {
    if (!context) return fallback;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = fallback;
    context.fillStyle =
      styles.getPropertyValue(token).trim() || fallback;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(
      0,
      0,
      1,
      1,
    ).data;
    return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
  };
  return {
    primary: resolve('--primary', dark ? '#fafafa' : '#343434'),
    muted: resolve(
      '--muted-foreground',
      dark ? '#a3a3a3' : '#737373',
    ),
    border: resolve('--border', dark ? '#404040' : '#e5e5e5'),
  };
}

export default function TrafficTimeline({
  timeline,
  range,
  onRange,
  timeZone,
  metric,
  variant = 'columns',
  height,
}: {
  timeline: TrafficDataset['timeline'];
  range?: CaptureRange;
  onRange?: (range: CaptureRange) => void;
  timeZone: string;
  metric: 'requests' | 'bytes';
  variant?: 'columns' | 'density';
  height?: number;
}) {
  const { resolvedTheme } = useTheme();
  const density = variant === 'density';
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [palette, setPalette] = useState({
    primary: '#343434',
    muted: '#737373',
    border: '#e5e5e5',
  });
  useEffect(() => {
    const root = document.documentElement;
    const updatePalette = () =>
      setPalette(chartPalette(root.classList.contains('dark')));
    // Read tokens after next-themes applies the class, not before its effect runs.
    const observer = new MutationObserver(updatePalette);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class'],
    });
    updatePalette();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!element) return;
    const measure = () =>
      setAvailableWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const format = useMemo(
    () => createTrafficTimeFormatter(timeZone),
    [timeZone],
  );
  const buckets = useMemo(() => {
    const sorted = [...timeline].sort((a, b) => a.epoch - b.epoch);
    const first = sorted[0]?.epoch ?? 0;
    const last = sorted.at(-1)?.epoch ?? first;
    const plotWidth =
      availableWidth - COLUMN_GRID_LEFT - COLUMN_GRID_RIGHT;
    const maximum = density
      ? 160
      : Math.min(
          120,
          Math.max(
            1,
            Math.floor(
              Math.max(1, plotWidth) /
                (COLUMN_GAP + COLUMN_MIN_WIDTH),
            ),
          ),
        );
    const width = Math.max(
      60000,
      Math.ceil((last - first + 60000) / (maximum * 60000)) * 60000,
    );
    const values = Array.from(
      {
        length: sorted.length
          ? Math.floor((last - first) / width) + 1
          : 0,
      },
      () => 0,
    );
    const populated = new Set<number>();
    for (const item of sorted) {
      const index = Math.floor((item.epoch - first) / width);
      populated.add(index);
      values[index] += density ? item.requests : item[metric];
    }
    const observed = [...populated].map((index) => values[index]);
    return {
      first,
      width,
      values,
      minimum: observed.length ? Math.min(...observed) : 0,
      maximum: observed.length ? Math.max(...observed) : 0,
    };
  }, [timeline, density, metric, availableWidth]);
  const { first, width, values, minimum, maximum } = buckets;
  const indexOf = (
    epoch: number | null | undefined,
    fallback: number,
  ) =>
    epoch == null
      ? fallback
      : Math.max(
          0,
          Math.min(
            values.length - 1,
            Math.floor((epoch - first) / width),
          ),
        );
  const color = palette.muted;
  const option = {
    animation: false,
    textStyle: { color },
    grid: {
      top: density ? 5 : 12,
      left: density ? 0 : COLUMN_GRID_LEFT,
      right: density ? 0 : COLUMN_GRID_RIGHT,
      // Keep edge labels from shrinking the density strip away from its slider.
      outerBoundsMode: density ? 'none' : 'auto',
      height: density ? 22.5 : undefined,
      bottom: density ? undefined : 42,
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const item = params as { dataIndex: number };
        const start = first + item.dataIndex * width;
        const value = values[item.dataIndex] ?? 0;
        return `${format(start)}<br/>Through ${format(start + width - 1)}<br/>${density || metric === 'requests' ? `${value.toLocaleString()} requests` : formatBytes(value)}`;
      },
    },
    // The slider controls a separate axis so the heatmap keeps its full extent.
    xAxis: [
      {
        type: 'category',
        data: values.map((_, index) => first + index * width),
        boundaryGap: true,
        min: density ? 0 : undefined,
        max: density ? values.length - 1 : undefined,
        axisLabel: {
          color,
          hideOverlap: true,
          formatter: (value: string) =>
            format(Number(value)).slice(5, 16),
        },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      ...(density && onRange
        ? [
            {
              type: 'category',
              data: values.map((_, index) => index),
              show: false,
            },
          ]
        : []),
    ],
    yAxis: density
      ? { type: 'category', data: ['Requests'], show: false }
      : {
          type: 'value',
          axisLabel: {
            color,
            formatter: (value: number) =>
              metric === 'bytes'
                ? formatBytes(value)
                : value.toLocaleString(),
          },
          splitLine: { lineStyle: { color: palette.border } },
        },
    // ECharts requires a visualMap for heatmaps; cells provide their own colors.
    visualMap: density
      ? {
          show: false,
          dimension: 2,
          min: minimum,
          max: maximum,
          inRange: { color: DENSITY_COLORS },
          outOfRange: { color: DENSITY_COLORS[0] },
        }
      : undefined,
    dataZoom:
      density && onRange
        ? [
            {
              type: 'slider',
              xAxisIndex: 1,
              left: 0,
              right: 0,
              bottom: 5,
              height: 11,
              brushSelect: false,
              handleIcon: 'path://M-2,0H2V20H-2Z',
              handleSize: '100%',
              fillerColor: 'rgba(255,255,255,0.25)',
              backgroundColor: palette.border,
              borderColor: palette.border,
              handleStyle: {
                color: '#ffffff',
                borderColor: palette.muted,
              },
              emphasis: {
                handleStyle: {
                  color: '#ffffff',
                  borderColor: palette.muted,
                },
              },
              filterMode: 'none',
              startValue: indexOf(range?.start, 0),
              endValue: indexOf(range?.end, values.length - 1),
              realtime: false,
              showDataShadow: false,
              showDetail: false,
            },
          ]
        : [],
    series: [
      density
        ? {
            type: 'heatmap',
            data: values.map((value, index) => {
              const start = first + index * width;
              const selected =
                (range?.start == null ||
                  start + width - 1 >= range.start) &&
                (range?.end == null || start <= range.end);
              const originalColor =
                minimum === maximum
                  ? DENSITY_COLORS[0]
                  : (echarts.color.lerp(
                      Math.max(
                        0,
                        Math.min(
                          1,
                          (value - minimum) / (maximum - minimum),
                        ),
                      ),
                      DENSITY_COLORS,
                    ) as string);
              const [red, green, blue] =
                echarts.color.parse(originalColor)!;
              const gray = Math.round(
                red * 0.2126 + green * 0.7152 + blue * 0.0722,
              );
              return {
                value: [index, 0, value],
                visualMap: false,
                itemStyle: {
                  color: selected
                    ? originalColor
                    : `rgb(${gray}, ${gray}, ${gray})`,
                  opacity: selected ? 1 : 0.5,
                },
                emphasis: {
                  itemStyle: { opacity: selected ? 1 : 0.5 },
                },
              };
            }),
            itemStyle: {
              borderWidth: 1,
              borderColor:
                resolvedTheme === 'dark' ? '#0f172a' : '#ffffff',
            },
            emphasis: {
              itemStyle: { borderWidth: 2, borderColor: '#ffffff' },
            },
          }
        : {
            type: 'bar',
            data: values,
            barCategoryGap: COLUMN_GAP,
            itemStyle: {
              color: palette.primary,
              opacity: 0.85,
              borderRadius: [3, 3, 0, 0],
            },
            emphasis: {
              itemStyle: { color: palette.primary, opacity: 1 },
            },
          },
    ],
  };
  const events = useMemo(
    () => ({
      click: (event: { dataIndex: number }) => {
        if (!onRange || !Number.isInteger(event.dataIndex)) return;
        const start = first + event.dataIndex * width;
        onRange({ start, end: start + width - 1 });
      },
      datazoom: (_event: unknown, chart: echarts.ECharts) => {
        if (!onRange || !values.length) return;
        const selected = (
          chart.getOption() as {
            dataZoom?: {
              startValue?: number;
              endValue?: number;
              start?: number;
              end?: number;
            }[];
          }
        ).dataZoom?.[0];
        if (!selected) return;
        if (
          (selected.start ?? 0) === 0 &&
          (selected.end ?? 100) === 100
        )
          onRange({ start: null, end: null });
        else {
          const start = Math.max(
            0,
            Math.floor(Number(selected.startValue ?? 0)),
          );
          const end = Math.min(
            values.length - 1,
            Math.ceil(Number(selected.endValue ?? values.length - 1)),
          );
          onRange({
            start: first + start * width,
            end: first + (end + 1) * width - 1,
          });
        }
      },
    }),
    [onRange, first, width, values.length],
  );

  if (!values.length)
    return (
      <div
        className='grid place-items-center text-xs text-muted-foreground'
        style={{ height: height ?? (density ? 72 : 210) }}
      >
        No timestamped requests in this selection.
      </div>
    );
  return (
    <div
      ref={setElement}
      role='img'
      aria-label={
        density
          ? `Request density heat map in ${timeZone}, with a range slider`
          : `${metric === 'bytes' ? 'Bytes' : 'Requests'} over time, column chart in ${timeZone}`
      }
    >
      <ReactECharts
        echarts={echarts}
        option={option}
        onEvents={events}
        opts={chartOptions}
        notMerge
        style={{
          height: height ?? (density ? 72 : 230),
          width: '100%',
        }}
      />
      {density && (
        <div className='flex flex-wrap items-center justify-between gap-2 px-2 text-[10px] text-muted-foreground'>
          <span>
            {width / 60000} min / cell · Click a cell or use the
            slider
          </span>
          <span className='flex items-center gap-2'>
            Min {minimum.toLocaleString()}
            <span
              className='h-2 w-24 rounded border'
              style={{
                background:
                  minimum === maximum
                    ? DENSITY_COLORS[0]
                    : `linear-gradient(to right, ${DENSITY_COLORS.join(', ')})`,
              }}
            />
            Max {maximum.toLocaleString()} requests
            {minimum === maximum && ' · No variation'}
          </span>
        </div>
      )}
    </div>
  );
}
