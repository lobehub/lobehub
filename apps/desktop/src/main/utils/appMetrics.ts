import { app, type ProcessMetric } from 'electron';

const MAX_AGE = 1500;

let cached: { at: number; metrics: ProcessMetric[] } | undefined;

// percentCPUUsage is measured since the previous getAppMetrics call anywhere in the
// process, so every reader must share one sample or each shortens the others' window.
export const getSharedAppMetrics = (now = Date.now()) => {
  if (!cached || now - cached.at >= MAX_AGE) cached = { at: now, metrics: app.getAppMetrics() };
  return cached.metrics;
};
