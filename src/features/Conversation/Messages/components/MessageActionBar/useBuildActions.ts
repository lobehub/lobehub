import { type MessageActionItem } from '../../../types';
import { branchingAction } from './actions/branching';
import { collapseAction } from './actions/collapse';
import { continueGenerationAction } from './actions/continueGeneration';
import { copyAction } from './actions/copy';
import { delAction } from './actions/del';
import { delAndRegenerateAction } from './actions/delAndRegenerate';
import { editAction } from './actions/edit';
import { regenerateAction } from './actions/regenerate';
import { shareAction } from './actions/share';
import { translateAction } from './actions/translate';
import { ttsAction } from './actions/tts';
import { type MessageActionContext } from './types';

/**
 * Calls every registered action's `useBuild` hook for the given context.
 *
 * Returns a record keyed by action `key`. Hook order is fixed — don't change
 * this call sequence without updating React dev expectations.
 *
 * Actions that don't apply to the current role return `null` and are simply
 * absent from the result when consumed.
 */
export const useBuildActions = (
  ctx: MessageActionContext,
): Record<string, MessageActionItem | null> => ({
  branching: branchingAction.useBuild(ctx),
  collapse: collapseAction.useBuild(ctx),
  continueGeneration: continueGenerationAction.useBuild(ctx),
  copy: copyAction.useBuild(ctx),
  del: delAction.useBuild(ctx),
  delAndRegenerate: delAndRegenerateAction.useBuild(ctx),
  edit: editAction.useBuild(ctx),
  regenerate: regenerateAction.useBuild(ctx),
  share: shareAction.useBuild(ctx),
  translate: translateAction.useBuild(ctx),
  tts: ttsAction.useBuild(ctx),
});
