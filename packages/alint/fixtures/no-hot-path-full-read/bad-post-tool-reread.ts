// Fixture: after each tool batch the step re-reads the whole topic, although
// the step-entry read already returned it and only the new tool rows changed.
import type { AgentState, StepContext, ToolResult } from './types';

export async function runToolBatch(ctx: StepContext, state: AgentState) {
  const history = await ctx.messageModel.query({ topicId: state.topicId });
  const results: ToolResult[] = [];

  for (const call of state.pendingToolCalls) {
    results.push(await ctx.executeTool(call, history));
  }

  await ctx.messageModel.insertToolResults(results);

  // alint-expect
  const refreshed = await ctx.messageModel.query({ topicId: state.topicId });

  return { ...state, messageCount: refreshed.length, pendingToolCalls: [] };
}
