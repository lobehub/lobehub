import type * as ElectronClientIpcModule from '@lobechat/electron-client-ipc';
import type { KimiCodeQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';

export const codexSnapshot = (
  overrides: Partial<ElectronClientIpcModule.CodexQuotaSnapshot> = {},
): ElectronClientIpcModule.CodexQuotaSnapshot => ({
  error: null,
  provider: 'codex',
  rateLimitResetCredits: null,
  session: null,
  status: 'ok',
  updatedAt: Date.now(),
  weekly: null,
  ...overrides,
});

export const kimiCodeSnapshot = (
  overrides: Partial<KimiCodeQuotaSnapshot> = {},
): KimiCodeQuotaSnapshot => ({
  error: null,
  extraUsage: null,
  monthly: null,
  monthlyCode: null,
  provider: 'kimi-code',
  session: null,
  status: 'ok',
  updatedAt: Date.now(),
  weekly: null,
  ...overrides,
});
