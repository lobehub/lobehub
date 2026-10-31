'use client';

import { cssVar } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import type { WidgetHealth } from '../utils/widgetHealth';

const pulse = stylex.keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.3 },
});

const styles = stylex.create({
  dot: {
    borderRadius: '50%',
    flex: 'none',
    height: '6px',
    width: '6px',
  },
  running: {
    animationDuration: '1.2s',
    animationIterationCount: 'infinite',
    animationName: pulse,
    animationTimingFunction: 'ease-in-out',
  },
});

export type WidgetHealthTone = 'failed' | 'idle' | 'ok' | 'running' | 'stale';

/** The single tone a widget's freshness reads as, most urgent first. */
export const getHealthTone = (health: WidgetHealth): WidgetHealthTone => {
  if (health.running) return 'running';
  if (health.failed) return 'failed';
  if (health.stale || health.partial) return 'stale';
  if (health.hasOutput) return 'ok';
  return 'idle';
};

export const HEALTH_TONE_COLOR: Record<WidgetHealthTone, string> = {
  failed: cssVar.colorError,
  idle: cssVar.colorTextQuaternary,
  ok: cssVar.colorSuccess,
  running: cssVar.colorPrimary,
  stale: cssVar.colorWarning,
};

/** A small dot carrying the widget's freshness next to its updated-at time. */
const HealthDot = memo<{ health: WidgetHealth }>(({ health }) => {
  const tone = getHealthTone(health);

  return (
    <span
      aria-hidden
      {...sx([styles.dot, tone === 'running' && styles.running], undefined, {
        background: HEALTH_TONE_COLOR[tone],
      })}
      data-widget-health={tone}
    />
  );
});

HealthDot.displayName = 'DashboardWidgetHealthDot';

export default HealthDot;
