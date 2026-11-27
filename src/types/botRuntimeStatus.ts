export const BOT_RUNTIME_STATUSES = {
  connected: 'connected',
  disconnected: 'disconnected',
  // Polling-mode bots silent for >7d enter dormant: continuous polling stops
  // and sparse alarm-driven probes detect new messages. See .
  dormant: 'dormant',
  failed: 'failed',
  queued: 'queued',
  // Disconnected on purpose because the bot sat idle past the deployment's
  // idle limit; `errorMessage` says why. Unlike `dormant`, nothing listens for
  // messages: the bot stays off until its owner comes back or the limit no
  // longer applies (see `@/business/server/bot/sleep`).
  sleeping: 'sleeping',
  starting: 'starting',
} as const;

/**
 * `errorCode` of a `sleeping` status: whether a plan upgrade would let the bot
 * stay idle longer, so the bot page knows whether to offer one.
 */
export const BOT_SLEEP_ERROR_CODES = {
  idle: 'idle_sleep',
  idleUpgradable: 'idle_sleep_upgradable',
} as const;

export type BotRuntimeStatus = (typeof BOT_RUNTIME_STATUSES)[keyof typeof BOT_RUNTIME_STATUSES];

export interface BotRuntimeStatusSnapshot {
  applicationId: string;
  /** Stable cross-platform gateway error code for client-side i18n. */
  errorCode?: string;
  errorMessage?: string;
  platform: string;
  status: BotRuntimeStatus;
  updatedAt: number;
}
