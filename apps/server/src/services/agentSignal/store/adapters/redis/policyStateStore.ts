import { AGENT_SIGNAL_KEYS } from '../../../constants';
import type { AgentSignalPolicyStateStore } from '../../types';
import { readHash, writeHash } from './shared';

/** Reads one persisted policy-state snapshot for a scope. */
export const readPolicyState = async (policyId: string, scopeKey: string) => {
  return readHash(AGENT_SIGNAL_KEYS.policy(policyId, scopeKey));
};

/** Writes one persisted policy-state snapshot for a scope. */
export const writePolicyState = async (
  policyId: string,
  scopeKey: string,
  data: Record<string, string>,
  ttlSeconds: number,
) => {
  await writeHash(AGENT_SIGNAL_KEYS.policy(policyId, scopeKey), data, ttlSeconds);
};

/** Redis-backed policy-state store used by AgentSignal policies. */
export const redisPolicyStateStore: AgentSignalPolicyStateStore = {
  readPolicyState,
  writePolicyState,
};
