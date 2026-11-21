import type * as ElectronClientIpcModule from '@lobechat/electron-client-ipc';
import type { KimiCodeQuotaSnapshot } from '@lobechat/heterogeneous-agents/quota';
import { act, screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { useAgentQuotaStore } from '@/store/agentQuota';
import { initialState } from '@/store/agentQuota/initialState';

/**
 * Start a case like a first launch: its own identity partition and an empty
 * in-memory replica, so no panel snapshot leaks between cases.
 */
export const isolateQuotaReplica = () => {
  const scope = `quota-menu-${Math.random().toString(36).slice(2)}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  act(() => useAgentQuotaStore.setState(initialState, false));
};

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

export const claudeSnapshot = (
  overrides: Partial<ElectronClientIpcModule.ClaudeCodeQuotaSnapshot> = {},
): ElectronClientIpcModule.ClaudeCodeQuotaSnapshot => ({
  error: null,
  provider: 'claude-code',
  scopedWeekly: null,
  session: null,
  status: 'ok',
  updatedAt: Date.now(),
  weekly: null,
  ...overrides,
});

export const persistedAccount = (updatedAt = Date.now()) => ({
  externalAccountId: 'ext-1',
  id: 'acc-1',
  provider: 'claude-code',
  updatedAt: new Date(updatedAt),
});

/** The account's newest persisted session reading, captured at `capturedAt`. */
export const persistedSessionReading = (capturedAt: number) => ({
  capturedAt,
  limitType: 'session',
  resetsAt: null,
  scopeKey: '',
  utilization: 8,
});

/** A live session reading as fossilized by the desktop sampler at `capturedAt`. */
export const liveSessionReading = (capturedAt: number) => ({
  capturedAt,
  isActive: true,
  limitType: 'session',
  resetsAt: null,
  scopeKey: '',
  utilization: 8,
});

/** Persisted quota can render before the initial load finishes; focus is ignored while loading. */
export const waitForQuotaIdle = async () => {
  await waitFor(() => expect(screen.getByTestId('refresh').hasAttribute('disabled')).toBe(false));
  // Let the focus listener's effect observe loading=false before dispatching focus.
  await act(async () => {
    await Promise.resolve();
  });
};
