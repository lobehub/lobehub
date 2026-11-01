import type { AcceptanceModel } from '@/database/models/acceptance';
import type { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { VerifyRunModel } from '@/database/models/verifyRun';
import type { VerifyCheckResultItem, VerifyRunItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

/**
 * What the `AcceptanceService` sub-domain modules read from the service.
 *
 * Use when:
 * - A function under `acceptanceService/` needs the caller scope, the actor,
 *   or one of the models the service instance owns
 *
 * Expects:
 * - The service builds it on every call, so a field replaced after
 *   construction (and a spied `loadRounds`) is what the function sees
 */
export interface AcceptanceServiceDeps {
  acceptanceModel: AcceptanceModel;
  /** Who is credited for the writes; see `AcceptanceService.actorUserId`. */
  actorUserId: string;
  db: LobeChatDatabase;
  loadRounds: (
    acceptanceId: string,
  ) => Promise<{ results: VerifyCheckResultItem[]; runs: VerifyRunItem[] }>;
  resultModel: VerifyCheckResultModel;
  runModel: VerifyRunModel;
  userId: string;
  workspaceId?: string;
}

/** The parameters of a sub-domain function after its leading `deps`. */
export type WithoutDeps<F> = F extends (deps: AcceptanceServiceDeps, ...args: infer A) => unknown
  ? A
  : never;
