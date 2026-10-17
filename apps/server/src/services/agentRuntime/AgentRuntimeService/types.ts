import type { Agent, GeneralAgentConfig } from '@lobechat/agent-runtime';
import type { ISnapshotStore } from '@lobechat/agent-tracing';
import {
  type ExecSubAgentParams,
  type ExecSubAgentResult,
  type ExecVirtualSubAgentParams,
} from '@lobechat/types';

import { type AgentRuntimeCoordinatorOptions } from '@/server/modules/AgentRuntime';
import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import type { QueueService } from '@/server/services/queue';

import { type ExecGroupMemberParams, type ExecGroupMemberResult } from '../types';

export interface InterventionLifecycleCheckpoint {
  state: 'completed' | 'pending';
  stepIndex: number;
}

/**
 * Operations the runtime delegates UP to its owning layer (AiAgentService).
 *
 * The dependency arrow is one-way: AiAgentService → AgentRuntimeService. The
 * runtime is the low-level step executor — it cannot resolve agent configs,
 * build tool engines, manage threads, or run the full `execAgent` pipeline;
 * those live in the layer above it. Yet some tools (e.g. `lobe-agent.callSubAgent`)
 * need exactly such a high-level action *mid-step*. Rather than import
 * AiAgentService (which would be a circular dependency), the runtime delegates
 * these operations back to its owner through callbacks injected here.
 *
 * Convention: every future "the runtime, mid-execution, must trigger a
 * higher-layer pipeline" capability belongs on this delegate — not as a loose
 * top-level option. One named home for the whole upward-call surface.
 */
export interface AgentRuntimeDelegate {
  /**
   * Fork a group member ("call agent member") under a `lobe-group-management`
   * tool call. Handles both in-group (non-isolated, shared group session) and
   * isolated members, installing the group-action member completion bridge that
   * enforces the K=N member barrier before resuming/finishing the supervisor.
   */
  execGroupMember?: (params: ExecGroupMemberParams) => Promise<ExecGroupMemberResult>;
  /**
   * Run a legacy agent invocation through the full high-level pipeline
   * (AiAgentService.execSubAgent → execAgent: agent-config resolution, tool
   * engine, context engineering, createOperation).
   */
  execSubAgent?: (params: ExecSubAgentParams) => Promise<ExecSubAgentResult>;
  /**
   * Fork a `lobe-agent.callSubAgent` virtual child run. The child is marked as a
   * sub-agent and owns the completion bridge that backfills the parent tool
   * placeholder before resuming the parked parent operation.
   */
  execVirtualSubAgent?: (params: ExecVirtualSubAgentParams) => Promise<ExecSubAgentResult>;
  /**
   * Re-check that an Agent Share visitor run is STILL authorized to continue,
   * called on EVERY step. Without it, a revocation that lands mid-run (link →
   * private, share disabled, agent deleted) would only stop NEW requests: the
   * already-created operation keeps its tool snapshot and gateway channel and
   * keeps running under the CREATOR's credentials and budget, unstoppable by
   * the visitor (whose Stop button re-resolves the now-private share and gets
   * `FORBIDDEN`). Re-checking at every step boundary means a revocation always
   * takes effect within one step, with no durable interrupt-retry machinery.
   *
   * Implemented by AiAgentService via `AgentShareModel.isRunStillAuthorized`.
   * Returns `false` (not a throw) for an ordinary "no longer authorized"
   * outcome; the caller treats a THROWN error the same as `false` — fail
   * closed, never fail open.
   */
  verifyShareRunStillAuthorized?: (params: {
    agentId: string;
    shareId: string;
  }) => Promise<boolean>;
}

export interface AgentRuntimeServiceOptions {
  /**
   * Custom agent factory. When provided, this function is called instead of
   * the default `new GeneralChatAgent(config)` to create the Agent instance.
   * This allows injecting alternative Agent implementations (e.g. GraphAgent)
   * without the service needing to know about them.
   */
  agentFactory?: (config: GeneralAgentConfig) => Agent;
  /**
   * Coordinator configuration options
   * Allows injection of custom stateManager and streamEventManager
   */
  coordinatorOptions?: AgentRuntimeCoordinatorOptions;
  /**
   * Operations the runtime delegates up to its owning layer. See
   * {@link AgentRuntimeDelegate}. Injected by AiAgentService so the runtime can
   * trigger high-level pipelines (e.g. sub-agent forking) mid-step without a
   * circular import.
   */
  delegate?: AgentRuntimeDelegate;
  /**
   * Opt IN to agent-share visitor rows for the models this service owns.
   * Reserved for share-runtime entry points that drive a visitor turn under
   * the CREATOR's `userId`. Defaults to false. See
   * {@link import('@/database/models/message').MessageModelOptions}.
   */
  includeShareVisitor?: boolean;
  /**
   * Custom QueueService
   * Set to null to disable queue scheduling (for synchronous execution tests)
   */
  queueService?: QueueService | null;
  /**
   * Optional snapshot store for persisting agent execution traces.
   * When provided, execution snapshots are recorded on every step and finalized on completion.
   * In dev mode without this option, falls back to FileSnapshotStore automatically.
   */
  snapshotStore?: ISnapshotStore;
  /**
   * Custom StreamEventManager
   * Defaults to Redis-based StreamEventManager
   * Can pass InMemoryStreamEventManager in test environments
   */
  streamEventManager?: IStreamEventManager;
  /**
   * Workspace id for scoping all DB reads/writes (messages, agent_operations).
   * Falls back to user-personal scope when omitted.
   */
  workspaceId?: string;
}

/**
 * Agent Runtime Service
 * Encapsulates Agent execution logic and provides a unified service interface
 *
 * Supports dependency injection for testing with in-memory implementations:
 * ```ts
 * // Production environment (uses Redis by default)
 * const service = new AgentRuntimeService(db, userId);
 *
 * // Test environment
 * const service = new AgentRuntimeService(db, userId, {
 *   streamEventManager: new InMemoryStreamEventManager(),
 *   queueService: null, // Disable queue, use executeSync
 * });
 * ```
 */

/** A sibling-module function's arguments after the service it runs against. */
export type MethodArgs<F> = F extends (svc: any, ...args: infer A) => any ? A : never;
