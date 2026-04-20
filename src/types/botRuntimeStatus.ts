export const BOT_RUNTIME_STATUSES = {
  connected: 'connected',
  disconnected: 'disconnected',
  // Polling-mode bots silent for >7d enter dormant: continuous polling stops
  // and sparse alarm-driven probes detect new messages. See LOBE-7320.
  dormant: 'dormant',
  failed: 'failed',
  queued: 'queued',
  starting: 'starting',
} as const;

export type BotRuntimeStatus = (typeof BOT_RUNTIME_STATUSES)[keyof typeof BOT_RUNTIME_STATUSES];

export interface BotRuntimeStatusSnapshot {
  applicationId: string;
  errorMessage?: string;
  platform: string;
  status: BotRuntimeStatus;
  updatedAt: number;
}
