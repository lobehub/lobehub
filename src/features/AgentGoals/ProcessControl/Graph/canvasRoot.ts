import * as stylex from '@stylexjs/stylex';
import { type CSSProperties } from 'react';

import { sx } from '@/styles/sx';

import { MUTED_EDGE_OPACITY, MUTED_EDGE_OPACITY_DARK } from './mainline';

const CANVAS_SCOPE_CLASS = 'lobe-canvas-e3dae3fb-canvas';

const EDGE_OPACITY_VARS = {
  '--goal-muted-edge-opacity': MUTED_EDGE_OPACITY,
  '--goal-muted-edge-opacity-dark': MUTED_EDGE_OPACITY_DARK,
} as CSSProperties;

const styles = stylex.create({
  canvas: {
    position: 'relative',
    width: '100%',
    height: '560px',
  },
  fullscreen: {
    height: '100%',
  },
});

export const canvasRootProps = (fullscreen: boolean, inlineHeight: number) =>
  sx(
    [styles.canvas, fullscreen && styles.fullscreen],
    CANVAS_SCOPE_CLASS,
    fullscreen ? EDGE_OPACITY_VARS : { ...EDGE_OPACITY_VARS, height: inlineHeight },
  );
