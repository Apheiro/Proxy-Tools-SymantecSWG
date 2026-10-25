import type { Variants } from 'motion/react';

export type WindowMotionGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  dockX: number;
  dockY: number;
  reduced: boolean;
  restoring: boolean;
};
const ease = [0.4, 0, 0.2, 1] as const;
export const windowMotion: Variants = {
  enter: (g: WindowMotionGeometry) => ({
    left: g.left,
    top: g.top + 10,
    width: g.width,
    height: g.height,
    borderRadius: 12,
    opacity: 0,
  }),
  circle: (g: WindowMotionGeometry) => ({
    left: g.dockX - 6,
    top: g.dockY - 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    opacity: 1,
  }),
  open: (g: WindowMotionGeometry) => ({
    left: g.left,
    top: g.top,
    width: g.width,
    height: g.height,
    borderRadius: 12,
    opacity: 1,
    pointerEvents: 'auto',
    transition: {
      duration: g.reduced ? 0 : g.restoring ? 0.44 : 0.22,
      ease,
    },
  }),
  minimized: (g: WindowMotionGeometry) => {
    if (g.reduced)
      return {
        opacity: 0,
        pointerEvents: 'none',
        transition: { duration: 0 },
      };
    const middleWidth = g.width * 0.55;
    const middleHeight = g.height * 0.5;
    const centerY = g.top + g.height / 2;
    return {
      width: [g.width, middleWidth, 72, 12],
      height: [g.height, middleHeight, 72, 12],
      left: [
        g.left,
        g.dockX - middleWidth / 2,
        g.dockX - 36,
        g.dockX - 6,
      ],
      top: [
        g.top,
        centerY + (g.dockY - centerY) * 0.3 - middleHeight / 2,
        g.dockY - 92,
        g.dockY - 6,
      ],
      borderRadius: [12, 40, 36, 6],
      opacity: [1, 1, 1, 0],
      pointerEvents: 'none',
      transition: { duration: 0.56, times: [0, 0.4, 0.82, 1], ease },
    };
  },
};
export const windowContentsMotion: Variants = {
  enter: { opacity: 1 },
  circle: { opacity: 0 },
  open: { opacity: 1, transition: { duration: 0.16 } },
  minimized: { opacity: 0, transition: { duration: 0.14 } },
};
export const windowCircleMotion: Variants = {
  enter: { opacity: 0 },
  circle: { opacity: 1 },
  open: { opacity: 0, transition: { duration: 0.2 } },
  minimized: {
    opacity: [0, 0, 1, 1],
    transition: { duration: 0.56, times: [0, 0.35, 0.82, 1] },
  },
};
