import type { AgentNumberChargeType } from '@lobechat/types';

/**
 * Business slots for the paid dedicated agent number.
 *
 * The OSS build bills nothing on its own: a self-hosted deployment pays its own
 * carrier invoice, so every slot here admits and records nothing. The cloud
 * build overrides this module to (1) require an active number subscription
 * before a number is handed out, (2) consult the user's spend budget before a
 * billable send, and (3) mirror each charge into the spend ledger.
 *
 * The OSS number service still keeps its own per-agent ledger and enforces its
 * own cap, so a missing override never means "unlimited".
 */

export interface DedicatedNumberAuthorizationParams {
  agentId: string;
  /** Requested area code, when the user picked one. */
  areaCode?: string;
  provider: string;
  userId: string;
  workspaceId?: string;
}

export interface DedicatedNumberAuthorizationResult {
  allowed: boolean;
  /** Shown to the user when `allowed` is false (e.g. "subscribe to get a number"). */
  reason?: string;
}

/**
 * Payment entry: may this user give this agent a dedicated number? Called
 * before any number is claimed or bought.
 *
 * Default: allowed — the operator of a self-hosted deployment is the payer.
 */
export async function authorizeDedicatedNumber(
  _params: DedicatedNumberAuthorizationParams,
): Promise<DedicatedNumberAuthorizationResult> {
  return { allowed: true };
}

export interface AgentNumberSpendCheckParams {
  agentId: string;
  /** Estimated USD of the charge about to be incurred. */
  estimatedUsd: number;
  type: AgentNumberChargeType;
  userId: string;
  workspaceId?: string;
}

/**
 * Budget admission for a billable number action (an outbound SMS).
 *
 * Default: allowed — the OSS per-agent cap still applies.
 */
export async function checkAgentNumberSpendAllowance(
  _params: AgentNumberSpendCheckParams,
): Promise<{ allowed: boolean }> {
  return { allowed: true };
}

export interface AgentNumberChargeRecord {
  agentId: string | null;
  amountUsd: number;
  /** Idempotency key shared with the OSS ledger row. */
  externalId: string;
  numberId: string | null;
  occurredAt: Date;
  quantity: number;
  type: AgentNumberChargeType;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Mirror a recorded charge into the deployment's spend ledger. Called once per
 * newly recorded OSS ledger row, never for a duplicate.
 *
 * Default: no-op.
 */
export async function recordAgentNumberCharge(_charge: AgentNumberChargeRecord): Promise<void> {}

/**
 * The user gave the number up (it is now in quarantine): stop the recurring
 * charge. Default: no-op.
 */
export async function onDedicatedNumberUnsubscribed(_params: {
  agentId: string | null;
  numberId: string;
  userId: string | null;
}): Promise<void> {}
