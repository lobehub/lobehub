import type { PERMISSION_ACTIONS } from '@lobechat/const/rbac';

import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';

import type { QuickNoteExecutorContext } from './types';
import { QuickNoteApplyError } from './types';

/**
 * Requires the workspace capability the ordinary creation path of a product object requires.
 *
 * Use when:
 * - An executor is about to create a Page (`DOCUMENT_CREATE`) or a Topic (`TOPIC_CREATE`).
 *   Applying a Proposal is admitted by `agent:update` only, so without this check a role that is
 *   denied the creation capability could still create the object through a Proposal, including
 *   through a score-4 automatic apply.
 *
 * Expects:
 * - Same semantics as the router's `withScopedPermission(action)`: personal scope is never gated,
 *   and either the `:all` or the `:owner` grant passes.
 *
 * Throws:
 * - {@link QuickNoteApplyError} `forbidden` when the workspace role lacks the capability. A manual
 *   apply surfaces it as `FORBIDDEN`; an automatic apply logs it and leaves the Proposal pending.
 */
export const assertQuickNoteCreatePermission = async (
  ctx: Pick<QuickNoteExecutorContext, 'db' | 'userId' | 'workspaceId'>,
  action: keyof typeof PERMISSION_ACTIONS,
) => {
  if (!ctx.workspaceId) return;

  const allowed = await hasWorkspaceScopedPermission({
    action,
    db: ctx.db,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  if (!allowed) {
    throw new QuickNoteApplyError('forbidden', `Workspace role lacks the ${action} permission`);
  }
};
