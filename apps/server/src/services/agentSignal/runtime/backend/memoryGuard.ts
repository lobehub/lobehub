import { AGENT_SIGNAL_DEFAULTS } from '../../constants';
import { ExpiringMap } from '../../store/adapters/memory/expiringMap';
import type { RuntimeGuardBackend, RuntimeGuardState } from '../AgentSignalRuntime';

const guardStates = new ExpiringMap<RuntimeGuardState>();

/**
 * Process-local runtime guard state for non-durable Agent Signal execution.
 *
 * Local workflow invocations share this backend for the server process lifetime,
 * while TTL cleanup mirrors the expiry boundary of the Redis-backed guard.
 */
export const inMemoryRuntimeGuardBackend: RuntimeGuardBackend = {
  async getGuardState(scopeKey, lane) {
    return guardStates.get(`${scopeKey}:${lane}`) ?? {};
  },
  async touchGuardState(scopeKey, lane, now) {
    const key = `${scopeKey}:${lane}`;
    const current = guardStates.get(key) ?? {};
    const next = {
      lastEventAt: now,
      startedAt: current.startedAt ?? now,
    } satisfies RuntimeGuardState;

    guardStates.set(key, next, AGENT_SIGNAL_DEFAULTS.runtimeGuardTtlSeconds * 1000);

    return next;
  },
};
