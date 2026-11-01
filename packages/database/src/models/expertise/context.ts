import { expertiseDomains } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { ExpertiseModel } from './index';

/** The caller identity every `ExpertiseModel` query is scoped by. */
export interface ExpertiseContext {
  db: LobeChatDatabase;
  /**
   * The model instance itself. A query that builds on another public method calls it through
   * here, so the call still dispatches through the instance as `this.<method>` did.
   */
  model: Pick<
    ExpertiseModel,
    'createDomain' | 'findDomain' | 'findLesson' | 'listDomainsForOwner' | 'sameReach'
  >;
  userId: string;
  workspaceId?: string;
}

/** The parameters of a module function after its leading `ctx`, for the model's delegators. */
export type ExpertiseArgs<F> = F extends (ctx: ExpertiseContext, ...args: infer A) => unknown
  ? A
  : never;

/** Confines a query to the domains the caller owns: their own, or the active workspace's. */
export const domainScopeWhere = (ctx: ExpertiseContext) =>
  buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, expertiseDomains);
