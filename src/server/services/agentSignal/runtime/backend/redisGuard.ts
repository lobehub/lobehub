import { AGENT_SIGNAL_DEFAULTS } from '../../constants';
import { redisPolicyStateStore } from '../../store/adapters/redis/policyStateStore';
import type { AgentSignalPolicyStateStore } from '../../store/types';
import type { RuntimeGuardBackend, RuntimeGuardState } from '../AgentSignalRuntime';

const RUNTIME_GUARD_POLICY_PREFIX = 'runtime-guard';

const createRuntimeGuardPolicyId = (lane: string) => {
  return `${RUNTIME_GUARD_POLICY_PREFIX}:${lane}`;
};

const fromPersistedGuardState = (value?: Record<string, string>): RuntimeGuardState => {
  if (!value) return {};

  return {
    lastEventAt: typeof value.lastEventAt === 'string' ? Number(value.lastEventAt) : undefined,
    startedAt: typeof value.startedAt === 'string' ? Number(value.startedAt) : undefined,
  };
};

const toPersistedGuardState = (state: RuntimeGuardState): Record<string, string> => {
  return {
    ...(state.lastEventAt !== undefined && { lastEventAt: String(state.lastEventAt) }),
    ...(state.startedAt !== undefined && { startedAt: String(state.startedAt) }),
  };
};

/**
 * Creates a Redis-backed runtime guard backend.
 *
 * Use when:
 * - AgentSignal execution runs in separate Upstash workflow invocations
 * - debounce/throttle/outer-timeout guards must survive process boundaries
 *
 * Expects:
 * - `stateStore` persists small hash snapshots per lane and scope
 *
 * Returns:
 * - A runtime guard backend compatible with {@link createAgentSignalRuntime}
 */
export const createRedisRuntimeGuardBackend = (
  stateStore: AgentSignalPolicyStateStore = redisPolicyStateStore,
): RuntimeGuardBackend => {
  return {
    async getGuardState(scopeKey, lane) {
      return fromPersistedGuardState(
        await stateStore.readPolicyState(createRuntimeGuardPolicyId(lane), scopeKey),
      );
    },
    async touchGuardState(scopeKey, lane, now) {
      const policyId = createRuntimeGuardPolicyId(lane);
      const current = fromPersistedGuardState(await stateStore.readPolicyState(policyId, scopeKey));
      const next = {
        lastEventAt: now,
        startedAt: current.startedAt ?? now,
      } satisfies RuntimeGuardState;

      await stateStore.writePolicyState(
        policyId,
        scopeKey,
        toPersistedGuardState(next),
        AGENT_SIGNAL_DEFAULTS.runtimeGuardTtlSeconds,
      );

      return next;
    },
  };
};
