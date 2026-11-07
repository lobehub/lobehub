import { VERIFY_RUNTIME_CAPABILITIES } from '@lobechat/prompts';
import type {
  VerifyAgentPlanConfig,
  VerifyCheckItem,
  VerifyRuntimeCapability,
} from '@lobechat/types';
import debug from 'debug';

import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { LobeChatDatabase } from '@/database/type';
import type { ExecutionPlan } from '@/helpers/executionTarget';

import { planItemToPendingResult } from './resultSnapshot';
import { VerifyStatusService } from './statusService';

const log = debug('lobe-server:verify-runtime-capabilities');

/**
 * Stable code written into the limitation of every check a round could not
 * exercise because its run lacked an execution capability. Settlement matches
 * on it to report "environment unavailable" instead of a generic verifier error,
 * so the builder is never told its delivery failed for something it could not
 * have produced.
 */
export const ENVIRONMENT_UNAVAILABLE_CODE = 'environment_unavailable';

/** Whether an errored check's recorded cause is a missing runtime capability. */
export const isEnvironmentUnavailableFailure = (text?: string | null): boolean =>
  !!text && text.includes(ENVIRONMENT_UNAVAILABLE_CODE);

/**
 * The capabilities a run actually had, read off its resolved execution plan.
 *
 * `cloud_sandbox` follows the session-context fact the builder was shown
 * ("Cloud sandbox reachable for credential injection"): `runCommand` /
 * `execScript` reach the cloud sandbox whenever no device is routed, and in
 * `auto` mode even alongside a routed device. Unlike that fact, a plain-chat
 * plan (`none`) counts as having none — it gets no execution tools at all.
 *
 * The answer is over the whole run, not its final step: a `device-unrouted`
 * run starts on the cloud sandbox and may activate a device mid-run (the
 * remote-device tool), leaving a device bound at completion although the
 * sandbox was there earlier. Only a run routed to a device from its start
 * (`device` plan outside `auto`) never had the sandbox.
 *
 * Returns undefined when the plan is unknown (old / resumed operations), so the
 * gate stays open rather than blocking on a guess.
 */
export const resolveRunCapabilities = (
  executionPlan: ExecutionPlan | undefined,
  activeDeviceId: string | undefined,
): VerifyRuntimeCapability[] | undefined => {
  if (!executionPlan) return undefined;
  if (executionPlan.kind === 'none') return [];

  const sandboxReachable =
    executionPlan.kind !== 'device' || !activeDeviceId || executionPlan.target === 'auto';
  return sandboxReachable ? ['cloud_sandbox'] : [];
};

const declaredCapabilities = (item: VerifyCheckItem): VerifyRuntimeCapability[] => {
  const declared = (item.verifierConfig as VerifyAgentPlanConfig | undefined)?.requiredCapabilities;
  if (!Array.isArray(declared)) return [];
  return declared.filter((c): c is VerifyRuntimeCapability =>
    (VERIFY_RUNTIME_CAPABILITIES as readonly string[]).includes(c),
  );
};

export interface UnsatisfiableItem {
  item: VerifyCheckItem;
  missing: VerifyRuntimeCapability[];
}

/** Required plan items that need a capability the run did not have. */
export const findUnsatisfiableItems = (
  plan: VerifyCheckItem[],
  available: readonly VerifyRuntimeCapability[],
): UnsatisfiableItem[] =>
  plan.flatMap((item) => {
    if (item.required === false) return [];
    const missing = declaredCapabilities(item).filter((c) => !available.includes(c));
    return missing.length ? [{ item, missing }] : [];
  });

export const describeMissingCapabilities = (missing: readonly VerifyRuntimeCapability[]) =>
  `${ENVIRONMENT_UNAVAILABLE_CODE}: capabilities_missing=${[...new Set(missing)].join(',')}`;

/**
 * Settle a round that cannot be verified in this run's environment, before any
 * evidence turn or judge spends a call on it.
 *
 * Every unsatisfiable item is written `errored` with the environment code; the
 * rest of the plan is `skipped` (the round was blocked, not judged). The rollup
 * then derives `errored` — never `failed` — so neither auto-repair nor a
 * "delivery did not pass" verdict fires on a delivery nobody evaluated.
 */
export const settleEnvironmentUnavailable = async (
  db: LobeChatDatabase,
  userId: string,
  params: {
    operationId: string;
    plan: VerifyCheckItem[];
    unsatisfiable: UnsatisfiableItem[];
    verifyRunId: string;
  },
  workspaceId?: string,
): Promise<void> => {
  const { operationId, plan, unsatisfiable, verifyRunId } = params;
  const resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
  const missingByItem = new Map(unsatisfiable.map((u) => [u.item.id, u.missing]));
  const allMissing = unsatisfiable.flatMap((u) => u.missing);
  const completedAt = new Date();

  for (const item of plan) {
    const missing = missingByItem.get(item.id);
    await resultModel.upsertByCheckItem({
      ...planItemToPendingResult(verifyRunId, operationId, item),
      completedAt,
      status: missing ? 'errored' : 'skipped',
      toulmin: {
        limitation: missing
          ? `${describeMissingCapabilities(missing)} — this run's execution environment cannot exercise this check, so it was not evaluated.`
          : `${describeMissingCapabilities(allMissing)} — verification was blocked because other required checks need a capability this run lacks.`,
      },
      verdict: null,
      verifyRunId,
    });
  }

  log(
    'op %s blocked before verification: %s',
    operationId,
    describeMissingCapabilities(allMissing),
  );
  await new VerifyStatusService(db, userId, workspaceId).recompute(operationId);
};
