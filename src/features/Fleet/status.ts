import { cssVar } from 'antd-style';

export type StatusTone = 'idle' | 'paused' | 'running' | 'scheduled';

/**
 * Resolve a display tone from a task status plus the live operation state of
 * the local conversation. `liveRunning` reflects an in-flight agent run on
 * this device; task `status` covers account-wide state (e.g. scheduled runs
 * on another device that have no local operation).
 */
export const resolveStatusTone = (status: string | undefined, liveRunning: boolean): StatusTone => {
  if (liveRunning || status === 'running') return 'running';
  if (status === 'paused' || status === 'waitingForHuman') return 'paused';
  return 'idle';
};

export const STATUS_COLOR: Record<StatusTone, string> = {
  idle: cssVar.colorTextQuaternary,
  paused: cssVar.colorWarning,
  running: cssVar.colorSuccess,
  scheduled: cssVar.colorInfo,
};

/** i18n keys live in the `electron` namespace under `fleet.status.*`. */
export const STATUS_I18N_KEY: Record<StatusTone, string> = {
  idle: 'fleet.status.idle',
  paused: 'fleet.status.paused',
  running: 'fleet.status.running',
  scheduled: 'fleet.status.scheduled',
};
