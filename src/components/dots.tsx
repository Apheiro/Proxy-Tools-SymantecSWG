import { useEffect, useRef } from 'react';
import useTheme from '@/hook/useTheme';

type DotFieldProps = {
  width?: number;
  height?: number;
  density?: number;
  darkAreas?: number;
  contrast?: number;
  maxDotSize?: number;
  minDotSize?: number;
  background?: string;
  color?: string;
  seed?: number;
};

type DarkArea = {
  x: number;
  y: number;
  radius: number;
  power: number;
};

function random(seed: number) {
  let value = seed;
  return () => {
    value = Math.sin(value) * 10000;
    return value - Math.floor(value);
  };
}

function calculateNoise(
  x: number,
  y: number,
  areas: DarkArea[],
): number {
  let value = 0;

  for (const area of areas) {
    const dx = x - area.x;
    const dy = y - area.y;

    const distance = Math.sqrt(dx * dx + dy * dy);

    value += Math.max(0, 1 - distance / area.radius) * area.power;
  }

  return Math.min(1, value);
}

export default function DotField({
  width = 800,
  height = 500,
  density = 12,
  darkAreas = 8,
  contrast = 8,
  maxDotSize = 10,
  minDotSize = 1,
  background = '#ffffff00',
  seed = 42,
}: DotFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const rng = random(seed);

    const areas: DarkArea[] = Array.from(
      { length: darkAreas },
      () => ({
        x: rng() * width,
        y: rng() * height,
        radius: 80 + rng() * 250,
        power: 0.5 + rng(),
      }),
    );

    ctx.fillStyle = theme === 'dark' ? '#ffffff' : '#000000';

    for (let y = density; y < height; y += density) {
      for (let x = density; x < width; x += density) {
        const intensity = calculateNoise(x, y, areas);

        const radius =
          minDotSize + intensity * (maxDotSize - minDotSize);

        ctx.beginPath();

        ctx.arc(x, y, radius, 0, Math.PI * 2);

        ctx.fill();
      }
    }
  }, [
    width,
    height,
    density,
    darkAreas,
    contrast,
    background,
    seed,
    maxDotSize,
    minDotSize,
    theme,
  ]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        display: 'block',
        width: `${width}px`,
        height: `${height}px`,
      }}
    />
  );
}
