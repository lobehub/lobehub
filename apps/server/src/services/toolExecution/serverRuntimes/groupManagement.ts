/**
 * Group Management Server Runtime — server-side group orchestration.
 *
 * The supervisor agent runs as a normal durable QStash operation; its
 * `lobe-group-management` tool calls execute here as deferred tools. Each action
 * forks group member(s) via the injected `ctx.agentMember` runner and returns
 * `deferred: true`: the agent runtime parks the supervisor (`waiting_for_async_tool`),
 * and the group-action member completion bridge backfills + resumes/finishes it
 * once the K=N member barrier passes.
 *
 *   - speak      → one in-group member, resume (or finish on skipCallSupervisor)
 *   - broadcast  → N in-group members (tools disabled), resume/finish
 *   - delegate   → one in-group member, finish (supervisor hands off)
 *   - executeAgentTask(s) → isolated thread member(s), resume/finish
 *
 * Mirrors the client GroupOrchestrationRuntime semantics, but the supervisor's
 * own operation IS the orchestration loop — no separate driver.
 */
import type {
  BroadcastParams,
  CreateWorkflowParams,
  DelegateParams,
  ExecuteTaskParams,
  ExecuteTasksParams,
  InterruptParams,
  SpeakParams,
  SummarizeParams,
  VoteParams,
} from '@lobechat/builtin-tool-group-management';
import { GroupManagementIdentifier } from '@lobechat/builtin-tool-group-management';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { ToolExecutionContext } from '../types';
import type { ServerRuntimeRegistration } from './types';

const buildError = (content: string, code: string): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
});

const AGENT_MEMBER_UNAVAILABLE = buildError(
  'Group orchestration is not available in this runtime.',
  'AGENT_MEMBER_UNAVAILABLE',
);

const START_FAILED = buildError('Agent member(s) failed to start.', 'AGENT_MEMBER_START_FAILED');

class GroupManagementExecutionRuntime {
  // ==================== Communication Coordination ====================

  /** Let a single member speak in the shared group session (non-isolated). */
  speak = async (
    params: SpeakParams,
    ctx: ToolExecutionContext,
  ): Promise<BuiltinServerRuntimeOutput> => {
    if (!ctx.agentMember) return AGENT_MEMBER_UNAVAILABLE;
    if (!params.agentId) return buildError('agentId is required.', 'INVALID_ARGUMENTS');

    const { started } = await ctx.agentMember.run({
      members: [{ agentId: params.agentId, instruction: params.instruction }],
      mode: 'in_group',
      onComplete: params.skipCallSupervisor ? 'finish' : 'resume',
    });
    if (!started) return START_FAILED;

    return {
      content: '',
      deferred: true,
      state: { agentId: params.agentId, status: 'pending', type: 'speak' },
      success: true,
    };
  };

  /** Let multiple members respond in parallel (tools disabled — opinions only). */
  broadcast = async (
    params: BroadcastParams,
    ctx: ToolExecutionContext,
  ): Promise<BuiltinServerRuntimeOutput> => {
    if (!ctx.agentMember) return AGENT_MEMBER_UNAVAILABLE;
    const agentIds = params.agentIds ?? [];
    if (agentIds.length === 0) return buildError('agentIds is required.', 'INVALID_ARGUMENTS');

    const { started } = await ctx.agentMember.run({
      disableTools: true,
      members: agentIds.map((agentId) => ({ agentId, instruction: params.instruction })),
      mode: 'in_group',
      onComplete: params.skipCallSupervisor ? 'finish' : 'resume',
    });
    if (!started) return START_FAILED;

    return {
      content: '',
      deferred: true,
      state: { agentIds, status: 'pending', type: 'broadcast' },
      success: true,
    };
  };

  /** Delegate the conversation to a member; the supervisor exits afterwards. */
  delegate = async (
    params: DelegateParams,
    ctx: ToolExecutionContext,
  ): Promise<BuiltinServerRuntimeOutput> => {
    if (!ctx.agentMember) return AGENT_MEMBER_UNAVAILABLE;
    if (!params.agentId) return buildError('agentId is required.', 'INVALID_ARGUMENTS');

    const { started } = await ctx.agentMember.run({
      members: [{ agentId: params.agentId, instruction: params.reason }],
      mode: 'in_group',
      // Delegate hands control to the member — finish without another supervisor turn.
      onComplete: 'finish',
    });
    if (!started) return START_FAILED;

    return {
      content: '',
      deferred: true,
      state: { agentId: params.agentId, status: 'pending', type: 'delegate' },
      success: true,
    };
  };

  // ==================== Task Execution (isolated threads) ====================

  /**
   * Run a member as an isolated-thread task. `runInClient` only takes effect on
   * the desktop client (handled by the client orchestrator); on the cloud/web
   * server there is no local FS/shell, so the task always runs server-side.
   */
  executeAgentTask = async (
    params: ExecuteTaskParams,
    ctx: ToolExecutionContext,
  ): Promise<BuiltinServerRuntimeOutput> => {
    if (!ctx.agentMember) return AGENT_MEMBER_UNAVAILABLE;
    if (!params.agentId || !params.instruction) {
      return buildError('agentId and instruction are required.', 'INVALID_ARGUMENTS');
    }

    const { started } = await ctx.agentMember.run({
      members: [{ agentId: params.agentId, instruction: params.instruction }],
      mode: 'isolated',
      onComplete: params.skipCallSupervisor ? 'finish' : 'resume',
      timeout: params.timeout,
    });
    if (!started) return START_FAILED;

    return {
      content: '',
      deferred: true,
      state: { agentId: params.agentId, status: 'pending', type: 'executeAgentTask' },
      success: true,
    };
  };

  /** Run multiple members as parallel isolated-thread tasks. */
  executeAgentTasks = async (
    params: ExecuteTasksParams,
    ctx: ToolExecutionContext,
  ): Promise<BuiltinServerRuntimeOutput> => {
    if (!ctx.agentMember) return AGENT_MEMBER_UNAVAILABLE;
    const tasks = params.tasks ?? [];
    if (tasks.length === 0) return buildError('tasks is required.', 'INVALID_ARGUMENTS');

    const { started } = await ctx.agentMember.run({
      members: tasks.map((task) => ({ agentId: task.agentId, instruction: task.instruction })),
      mode: 'isolated',
      onComplete: params.skipCallSupervisor ? 'finish' : 'resume',
      // Per-task timeouts collapse to the longest; the barrier waits for all.
      timeout: tasks.reduce((max, task) => Math.max(max, task.timeout ?? 0), 0) || undefined,
    });
    if (!started) return START_FAILED;

    return {
      content: '',
      deferred: true,
      state: { status: 'pending', tasks: tasks.map((t) => t.agentId), type: 'executeAgentTasks' },
      success: true,
    };
  };

  // ==================== Not yet implemented on the server ====================
  // Mirror the client stubs: return inline (non-deferred) results so the
  // supervisor LLM keeps orchestrating instead of parking.

  interrupt = async (params: InterruptParams): Promise<BuiltinServerRuntimeOutput> => ({
    content: `Interrupt is not yet supported in server orchestration (task ${params.taskId}).`,
    success: true,
  });

  summarize = async (_params: SummarizeParams): Promise<BuiltinServerRuntimeOutput> => ({
    content: 'Summarize is not yet implemented in server orchestration.',
    success: true,
  });

  createWorkflow = async (params: CreateWorkflowParams): Promise<BuiltinServerRuntimeOutput> => ({
    content: `Workflow creation is not yet implemented ("${params.name}").`,
    success: true,
  });

  vote = async (params: VoteParams): Promise<BuiltinServerRuntimeOutput> => ({
    content: `Voting is not yet implemented (question: "${params.question}").`,
    success: true,
  });
}

const runtime = new GroupManagementExecutionRuntime();

export const groupManagementRuntime: ServerRuntimeRegistration = {
  factory: () => runtime,
  identifier: GroupManagementIdentifier,
};
