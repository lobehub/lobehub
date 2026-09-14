import type { AgentState } from '@lobechat/agent-runtime';
import type { UIChatMessage } from '@lobechat/types';

import type { RuntimeExecutorContext } from '@/server/modules/AgentRuntime/context';

/**
 * What every server-side fact provider may read.
 *
 * Providers turn the run's state plus the server's data sources into one fact
 * for the context snapshot. They are independent of each other, best-effort
 * (a failed lookup logs and yields `undefined`, never blocks the LLM call) and
 * run concurrently, so none may depend on another's result.
 */
export interface ServerContextFactInput {
  /** Device routed for this step, if any (single-track device gate applied). */
  activeDeviceId?: string;
  /** Executing agent row id (`origin.agentId`). */
  agentId?: string;
  ctx: RuntimeExecutorContext;
  /** Tool ids enabled for this step, after resolution. */
  enabledToolIds: string[];
  /** Effective execution target off the plan, when resolved. */
  executionTarget?: string;
  /** Conversation as the engine will see it (history hints already applied). */
  messagesForContext: UIChatMessage[];
  state: AgentState;
  /** Topic the turn belongs to (`ctx.topicId` wins over `origin.topicId`). */
  topicId?: string;
  /** Workspace scoping for DB models (`origin.workspaceId` wins over `ctx.workspaceId`). */
  workspaceId?: string;
}
