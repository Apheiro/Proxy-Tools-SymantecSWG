'use client';

import { useEffect, useMemo, useState } from 'react';

/** Match Traffic Analysis's density navigator without changing that component. */
export function useComparisonZoomSlider() {
  const [palette, setPalette] = useState({
    muted: '#737373',
    border: '#e5e5e5',
  });
  useEffect(() => {
    const root = document.documentElement;
    const updatePalette = () => {
      const dark = root.classList.contains('dark');
      const styles = getComputedStyle(root);
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
          0, 0, 1, 1,
        ).data;
        return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
      };
      setPalette({
        muted: resolve(
          '--muted-foreground',
          dark ? '#a3a3a3' : '#737373',
        ),
        border: resolve('--border', dark ? '#404040' : '#e5e5e5'),
      });
    };
    const observer = new MutationObserver(updatePalette);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class'],
    });
    updatePalette();
    return () => observer.disconnect();
  }, []);
  return useMemo(() => ({
    type: 'slider',
    xAxisIndex: 0,
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
    handleStyle: { color: '#ffffff', borderColor: palette.muted },
    emphasis: {
      handleStyle: { color: '#ffffff', borderColor: palette.muted },
    },
    filterMode: 'none',
    realtime: false,
    showDataShadow: false,
    showDetail: false,
  }), [palette]);
}
