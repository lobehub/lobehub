// Fixture: one full read builds the step's model context at entry; the only
// other full read is the rare reconnect path after a revision gap.
import type { AgentState, StepContext } from './types';

export async function buildStepContext(ctx: StepContext, state: AgentState) {
  // The model sees every message of the topic, so the full rows are needed.
  const messages = await ctx.messageModel.query({
    skipCompressedMembers: true,
    topicId: state.topicId,
  });

  return ctx.contextEngine.process({ messages, state });
}

/**
 * Rare: the client reconnected and its last revision is more than one patch
 * behind, so it needs the whole page once instead of a patch.
 */
export async function resyncAfterRevisionGap(ctx: StepContext, topicId: string) {
  const messages = await ctx.messageModel.query({ topicId });
  return { messages, revision: await ctx.messageModel.getTopicRevision(topicId) };
}
