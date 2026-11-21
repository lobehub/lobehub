import type { MessagePatchData } from '@lobechat/agent-gateway-client';
import type { AgentState } from '@lobechat/agent-runtime';
import type { UIChatMessage } from '@lobechat/types';

import {
  buildProjectedMessagePatch,
  fillCompressedGroupUpserts,
  hasCompressedGroupUpsert,
} from '../../messagePatch';
import type { DeferredMessagePatch } from '../../types';
import type { AgentRuntimeServiceContext } from '../types';

/** What this module reads off the service. */
export type StepMessagePatchDeps = Pick<
  AgentRuntimeServiceContext,
  'queryUiMessages' | 'streamManager'
>;

/** Identifies the conversation a step reads; a patch is diffed only within one. */
export const stepMessagesScopeKey = (state: AgentState): string =>
  JSON.stringify([
    state.origin?.agentId ?? null,
    state.origin?.topicId ?? null,
    state.origin?.groupId ?? null,
    state.origin?.threadId ?? null,
  ]);

/**
 * Publish a step's protocol v2 patch: what changed in the conversation between
 * the step's entry read (`before`) and `after`. Projected, because this runs
 * only for a client that asked for protocol 2, which renders tool view models
 * and can fetch a stored payload back. The model-facing lists are read
 * elsewhere, straight off `MessageModel`, and stay whole.
 *
 * Both sides leave compression-group members out, so a group the step created
 * or changed (a compression) is read once more with its members, from `state`,
 * before it ships. Nothing ships when that read fails, as when either side
 * could not be read.
 */
export async function publishStepMessagePatch(
  deps: StepMessagePatchDeps,
  {
    after,
    before,
    operationId,
    state,
    stepIndex,
  }: {
    after: UIChatMessage[];
    before: UIChatMessage[];
    operationId: string;
    state: AgentState;
    stepIndex: number;
  },
): Promise<void> {
  let patch: MessagePatchData | undefined = buildProjectedMessagePatch(
    before,
    after,
    stepIndex + 1,
  );
  if (hasCompressedGroupUpsert(patch)) {
    const withMembers = await deps.queryUiMessages(state, { skipWorks: true });
    patch = withMembers && fillCompressedGroupUpserts(patch, withMembers);
  }
  if (!patch) return;

  await deps.streamManager.publishStreamEvent(operationId, {
    data: patch,
    stepIndex,
    type: 'message_patch',
  });
}

/**
 * Publish a patch an inline step left for later. `entry` is the next step's
 * entry read, which serves as the "after" side when it covers the same
 * conversation; otherwise the conversation is read here, the way the step
 * would have read it when it ended.
 *
 * Best effort: a patch that never arrives costs the client one refetch, since
 * the next revision it sees (`step_start`, the next patch, `agent_runtime_end`)
 * no longer follows the last patch it applied. That must not fail the step.
 */
export async function publishDeferredMessagePatch(
  deps: StepMessagePatchDeps,
  operationId: string,
  patch: DeferredMessagePatch,
  entry?: { scopeKey: string; uiMessages?: UIChatMessage[] },
): Promise<void> {
  try {
    const after =
      entry?.uiMessages && entry.scopeKey === patch.scopeKey
        ? entry.uiMessages
        : await deps.queryUiMessages(patch.state, { skipCompressedMembers: true, skipWorks: true });
    if (!after) return;

    await publishStepMessagePatch(deps, {
      after,
      before: patch.before,
      operationId,
      state: patch.state,
      stepIndex: patch.stepIndex,
    });
  } catch (error) {
    console.error(
      '[%s][%d] Failed to publish the deferred message patch: %O',
      operationId,
      patch.stepIndex,
      error,
    );
  }
}
