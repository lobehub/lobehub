'use client';

import { createStaticStyles, cssVar, cx } from '@lobehub/ui';
import { memo } from 'react';

import type { WidgetHealth } from '../utils/widgetHealth';

const styles = createStaticStyles(({ css }) => ({
  dot: css`
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  `,
  running: css`
    @keyframes dashboard-health-pulse {
      0%,
      100% {
        opacity: 1;
      }

      50% {
        opacity: 0.3;
      }
    }

    animation: dashboard-health-pulse 1.2s ease-in-out infinite;
  `,
}));

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
      className={cx(styles.dot, tone === 'running' && styles.running)}
      data-widget-health={tone}
      style={{ background: HEALTH_TONE_COLOR[tone] }}
    />
  );
});

HealthDot.displayName = 'DashboardWidgetHealthDot';

export default HealthDot;
