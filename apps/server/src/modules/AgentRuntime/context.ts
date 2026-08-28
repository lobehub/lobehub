import { type AgentState } from '@lobechat/agent-runtime';
import { type BotPlatformContext } from '@lobechat/context-engine';
import {
  type ExecSubAgentParams,
  type ExecSubAgentResult,
  type ExecVirtualSubAgentParams,
} from '@lobechat/types';
import type { SearchDecision } from 'model-bank';

import { type MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { type EvalContext } from '@/server/modules/Mecha/ContextEngineering/types';
import type { HookDispatcher } from '@/server/services/agentRuntime/hooks/HookDispatcher';
import type {
  ExecGroupMemberParams,
  ExecGroupMemberResult,
} from '@/server/services/agentRuntime/types';
import type { ExecutionPrincipal } from '@/server/services/executionPrincipal';
import { type ToolExecutionService } from '@/server/services/toolExecution';

import { type IStreamEventManager } from './types';

export interface RuntimeExecutorContext {
  /**
   * Cancels tool work that is still in flight for this step. Driven by the
   * persisted interruption flag (the step runs in its own invocation, so there
   * is no in-process controller to share with whoever requested the stop).
   */
  abortSignal?: AbortSignal;
  agentConfig?: any;
  /**
   * Allows call_llm to publish visible_output_end immediately after a no-tool
   * LLM stream_end. Only the default GeneralChatAgent treats no-tool llm_result
   * as a final answer; injected multi-step agents such as GraphAgent can emit
   * tools: [] for an intermediate graph node and continue to another node.
   */
  allowEarlyFinalAnswerVisibleOutputEnd?: boolean;
  botContext?: unknown;
  botPlatformContext?: BotPlatformContext;
  discordContext?: any;
  evalContext?: EvalContext;
  /**
   * Callback to fork a group member ("call agent member") under a
   * `lobe-group-management` tool call. Injected by AiAgentService; powers the
   * per-tool `agentMember` runner (in-group + isolated members, K=N barrier).
   */
  execGroupMember?: (params: ExecGroupMemberParams) => Promise<ExecGroupMemberResult>;
  /**
   * Callback to run a legacy agent invocation server-side.
   * Injected by AiAgentService so exec_sub_agent / exec_sub_agents executors
   * can dispatch callAgent-triggered runs without a circular import.
   */
  execSubAgent?: (params: ExecSubAgentParams) => Promise<ExecSubAgentResult>;
  /**
   * Callback to fork a `lobe-agent.callSubAgent` virtual child run. Unlike
   * execSubAgent, this path installs the async completion bridge and marks the
   * child operation as a sub-agent.
   */
  execVirtualSubAgent?: (params: ExecVirtualSubAgentParams) => Promise<ExecSubAgentResult>;
  hookDispatcher?: HookDispatcher;
  loadAgentState?: (operationId: string) => Promise<AgentState | null>;
  messageModel: MessageModel;
  operationId: string;
  /**
   * Who this run executes as. Built once per operation by
   * `AgentRuntimeService` from `state.metadata` (`resolveRunPrincipal`) and
   * forwarded verbatim into `ToolExecutionContext.principal`.
   *
   * Mandatory, and the ONLY identity on this context: there is deliberately no
   * bare `userId` field, so nothing downstream can filter by "the user"
   * without stating whether it means the actor driving the run or the resource
   * owner whose data, credentials and balance it acts on. On an ordinary run
   * they are the same person; on a shared-agent visitor run they are not, and
   * `principal.delegation` states exactly what the visitor may reach.
   *
   * `principal.delegation` also carries the run's billing target for the
   * business model-runtime context (LLM spend goes to the creator's share
   * budget), the fail-closed file gate per-step context assembly applies
   * without re-deriving it (`applyShareGateToAgentConfig`), and the `shareId`
   * that lets cross-topic reads (`serverCallLlmContextBuilder`'s
   * `<refer_topic>` resolution, `lobe-topic-reference`'s `getTopicContext`)
   * reject a topic stamped with a DIFFERENT share instance — one the owner has
   * since disabled and replaced, even though `agentId` still matches.
   * See `topics.shareId`'s JSDoc (`packages/database/src/schemas/topic.ts`).
   */
  principal: ExecutionPrincipal;
  searchDecision?: SearchDecision;
  serverDB: LobeChatDatabase;
  stepIndex: number;
  stream?: boolean;
  streamManager: IStreamEventManager;
  toolExecutionService: ToolExecutionService;
  topicId?: string;
  /**
   * Trace-pipeline sink for context engine input/output. Wired by
   * AgentRuntimeService so the trace recorder can pick CE data up
   * out-of-band, keeping the heavy CE payload (agentDocuments, systemRole, …)
   * out of the `events` array and therefore out of the Redis state pipeline.
   *
   * Context: agent-runtime state blob was hitting Upstash Redis 10MB limit
   * because contextEngine.input (agentDocuments full inline) accounted for
   * ~83% of each step. Routing CE through this callback keeps the heavy
   * payload in trace only, reducing per-step Redis state from ~3.4MB to ~6KB.
   */
  tracingContextEngine?: (input: unknown, output: unknown) => void;
  userTimezone?: string;
  /**
   * Workspace scoping for ownership filters on models/services constructed
   * inside the agent runtime. Threaded down from the originating request
   * (chat/task router) and forwarded to tool executions via
   * `ToolExecutionContext.workspaceId`.
   */
  workspaceId?: string;
}
