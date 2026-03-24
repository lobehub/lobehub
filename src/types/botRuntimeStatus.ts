export const BOT_RUNTIME_STATUSES = {
  connected: 'connected',
  disconnected: 'disconnected',
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
