import { GroupAgentBuilderApiName, GroupAgentBuilderIdentifier } from './types';

interface ToolCallRef {
  apiName?: string;
  id?: string;
  identifier?: string;
}

/**
 * The `createGroup` calls the model issued in the same assistant message as
 * `toolCallId`.
 *
 * Calls from one message are not run in the order the model wrote them:
 * `createGroup` needs approval, so the agent runtime executes the siblings that
 * don't *before* parking for it. A sibling that relies on "the group this
 * conversation created" would then run while no group has been created yet and
 * silently fall back to the pinned group. Callers use this to spot that window.
 */
export const findSiblingCreateGroupCallIds = (
  tools: ToolCallRef[] | null | undefined,
  toolCallId: string | undefined,
): string[] =>
  (tools ?? [])
    .filter(
      (tool) =>
        tool.identifier === GroupAgentBuilderIdentifier &&
        tool.apiName === GroupAgentBuilderApiName.createGroup &&
        !!tool.id &&
        tool.id !== toolCallId,
    )
    .map((tool) => tool.id!);

const AWAITING_CREATE_GROUP_MESSAGE =
  'Not run: createGroup was called in the same step and has not returned yet (it may still be waiting for approval), so this call cannot tell which group to change. Call it again after createGroup returns, passing the groupId it returned.';

/** Result for a call that would otherwise run ahead of its sibling `createGroup`. */
export const AWAITING_CREATE_GROUP_RESULT = {
  content: AWAITING_CREATE_GROUP_MESSAGE,
  error: { message: AWAITING_CREATE_GROUP_MESSAGE, type: 'AwaitingCreateGroup' },
  success: false,
};
