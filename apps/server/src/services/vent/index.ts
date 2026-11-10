import { createHash } from 'node:crypto';

import type {
  VentLedger,
  VentParams,
  VentRejectionReason,
} from '@lobechat/builtin-tool-lobe-agent';
import {
  createMemoryVentLedger,
  getVentFingerprint,
  getVentScope,
  validateVentParams,
} from '@lobechat/builtin-tool-lobe-agent';

export { formatVentResultContent } from '@lobechat/builtin-tool-lobe-agent';

/** Input used by the vent service to record one report. */
export interface VentRecordInput {
  /** Stable agent id associated with the running agent. */
  agentId: string;
  /** Agent-declared vent payload. */
  input: VentParams;
  /** Runtime operation id when the vent is operation-scoped. */
  operationId?: string;
  /** Caller-provided tool-call id. */
  toolCallId?: string;
  /** Topic the vent belongs to. */
  topicId: string;
  /** Stable user id associated with the running agent. */
  userId: string;
}

export type VentRecordRejection = VentRejectionReason;

/** Result returned after one vent attempt. */
export interface VentResult {
  /** Optional rejection reason when nothing was recorded. */
  reason?: VentRecordRejection;
  /** Whether the vent was recorded. */
  recorded: boolean;
  /** Stable vent id built for recorded reports when available. */
  ventId?: string;
}

/** Vent recording service API consumed by the LobeAgent server runtime. */
export interface VentRuntimeService {
  recordVent: (input: VentRecordInput) => Promise<VentResult>;
}

/** Dependencies used by the pure vent recording service. */
export interface VentServiceDependencies {
  /** Tracks admitted vents per scope. Defaults to an in-memory ledger. */
  ledger?: VentLedger;
  /** Creates a stable tool-call id when the caller did not provide one. */
  nextToolCallId: () => string;
}

/** Minimal Redis surface the vent ledger needs (ioredis-compatible). */
export interface VentRedisClient {
  eval: (script: string, numKeys: number, ...args: (number | string)[]) => Promise<unknown>;
}

const VENT_LEDGER_TTL_SECONDS = 3 * 24 * 60 * 60;

// Check-and-add in one round trip so parallel tool calls of one step cannot
// both slip under the cap.
const ADMIT_SCRIPT = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 'duplicate' end
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 'rate_limited' end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 'accepted'
`;

/**
 * Redis-backed ledger. Consecutive steps of one server run may execute on
 * different instances, so a per-process count cannot hold the per-run cap.
 * Falls back to an in-memory ledger when Redis errors, so a vent never fails
 * the tool call. Accepted admissions are mirrored into that fallback; a vent
 * admitted only by the fallback is not replayed into Redis once it recovers,
 * which can let at most one extra vent through a flapping Redis.
 */
export const createRedisVentLedger = (
  redis: VentRedisClient,
  fallback: VentLedger = createMemoryVentLedger(),
): VentLedger => ({
  admit: async (params) => {
    try {
      const result = await redis.eval(
        ADMIT_SCRIPT,
        1,
        `vent:ledger:${params.scopeKey}`,
        createHash('sha256').update(params.fingerprint).digest('hex'),
        params.limit,
        VENT_LEDGER_TTL_SECONDS,
      );
      if (result === 'accepted' || result === 'duplicate' || result === 'rate_limited') {
        // Mirror admissions so a Redis outage later in the run still sees them.
        if (result === 'accepted') await fallback.admit(params);
        return result;
      }
    } catch (error) {
      console.error('[vent] Redis ledger failed, falling back to memory:', error);
    }

    return fallback.admit(params);
  },
});

const buildVentId = (params: {
  agentId: string;
  scopeKey: string;
  toolCallId: string;
  userId: string;
}) => `vent:${params.userId}:${params.agentId}:${params.scopeKey}:${params.toolCallId}`;

/**
 * Creates a vent recording service.
 *
 * Use when:
 * - The LobeAgent server runtime needs a DI-friendly vent boundary
 * - Tests need deterministic tool-call ids and ledger state
 *
 * Expects:
 * - The durable record is the persisted vent tool-call message itself
 * - The ledger owns the per-run cap and same-content dedupe
 *
 * Returns:
 * - A service that accepts valid vents and never mutates user-facing resources
 */
export const createVentService = (deps: VentServiceDependencies): VentRuntimeService => {
  const ledger = deps.ledger ?? createMemoryVentLedger();

  return {
    recordVent: async (input): Promise<VentResult> => {
      const invalid = validateVentParams(input.input);
      if (invalid) return { recorded: false, reason: invalid };

      const scope = getVentScope(input)!;
      const admission = await ledger.admit({
        fingerprint: getVentFingerprint(input.input),
        limit: scope.limit,
        scopeKey: `${input.userId}:${input.agentId}:${scope.key}`,
      });

      if (admission !== 'accepted') return { recorded: false, reason: admission };

      return {
        recorded: true,
        ventId: buildVentId({
          agentId: input.agentId,
          scopeKey: scope.key,
          toolCallId: input.toolCallId ?? deps.nextToolCallId(),
          userId: input.userId,
        }),
      };
    },
  };
};
