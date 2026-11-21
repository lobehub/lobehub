import type { AgentDocumentPolicyLoad } from '@lobechat/types';

import type { UpdateLoadRuleArgs, UpdateLoadRuleState } from '../../../types';

/**
 * The load mode the updateLoadRule card should name.
 *
 * Once the call settles only the stored mode counts: a maxTokens-only update
 * leaves a progressive document progressive, and a refused call (a folder)
 * changed nothing. The requested mode is shown only while the call runs.
 */
export const resolveInspectorLoadMode = ({
  args,
  inFlight,
  partialArgs,
  pluginState,
}: {
  args?: Partial<UpdateLoadRuleArgs>;
  inFlight?: boolean;
  partialArgs?: Partial<UpdateLoadRuleArgs>;
  pluginState?: UpdateLoadRuleState;
}): AgentDocumentPolicyLoad | undefined => {
  if (pluginState?.policyLoad) return pluginState.policyLoad;
  if (!inFlight) return undefined;
  return args?.rule?.mode || partialArgs?.rule?.mode;
};
