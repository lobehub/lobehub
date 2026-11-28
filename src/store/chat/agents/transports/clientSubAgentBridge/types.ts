import type { GroupOrchestrationSupervisorSnapshot as SupervisorSnapshot } from '@lobechat/agent-runtime';
import { type ConversationContext } from '@lobechat/types';

export interface SubAgentBridgeRegistration {
  /**
   * Whether the parent has actually parked. Registrations are created when
   * the child's spawner exits (the parent's tool lane just returned
   * `deferred`), which is BEFORE the parent's runtime reaches
   * `pauseForTools` — with parallel tool lanes, that gap can span the whole
   * sibling execution. An unarmed registration must not resume the parent:
   * the parent is still executing, and its own deferred path would later
   * overwrite the resumed turn with the "still running" placeholder.
   */
  armed?: boolean;
  /** The child's isolation context — supplies the registry key (threadId). */
  childContext: ConversationContext;
  /** The parked child run's operation (cleaned up once the bridge fires). */
  childOperationId: string;
  kind: 'sub-agent';
  /** Conversation context of the parked parent run (resume target). */
  parentContext: ConversationContext;
  /** The parked parent run's operation id (completed, then resumed). */
  parentOperationId: string;
  /** Message id of the parent's deferred placeholder tool message. */
  toolMessageId: string;
}
export interface GroupOrchestrationBridgeRegistration {
  /**
   * Same two-phase activation as the sub-agent kind: the group park-exit
   * registers BEFORE the orchestration loop has processed the member's
   * deferred pause.
   */
  armed?: boolean;
  childContext: ConversationContext;
  childOperationId: string;
  kind: 'group-orchestration';
  /** AgentId of the member whose parked run this bridge settles. */
  memberAgentId: string;
  /** Conversation context of the orchestration (messageContext). */
  messageContext: ConversationContext;
  /** The parked orchestration operation id (completed before re-entry). */
  orchestrationOperationId: string;
  supervisorAgentId: string;
  /**
   * Supervisor state machine counters at the park point (round /
   * skip-call-supervisor). Carried into the re-entry's task_completed payload
   * so the resumed loop continues from the original decision point instead of
   * resetting to a fresh supervisor machine.
   */
  supervisorSnapshot?: SupervisorSnapshot;
  /** Message id of the supervisor's group task tool message. */
  toolMessageId: string;
}

export type ClientSubAgentBridgeRegistration =
  GroupOrchestrationBridgeRegistration | SubAgentBridgeRegistration;

/** Terminal disposition of the child run, captured at the run boundary. */
export interface SubAgentBridgeOutcome {
  /** Cost of the child run (`AgentState.cost.total`), for the parent ledger. */
  cost?: number;
  error?: string;
  /** Terminal AgentState.status of the child run: done | error | interrupted. */
  status: 'done' | 'error' | 'interrupted';
  /** Token split of the child run (`AgentState.usage.llm.tokens`). */
  usage?: { input?: number; output?: number; total?: number };
}

export type { SupervisorSnapshot };

/**
 * Persisted bridge coordinates (`child thread .metadata.bridge`). The
 * module-level registry dies with the renderer, but a parked child outlives a
 * reload: its isolation thread, the parent's deferred placeholder, and the
 * pending approval are all persisted. Written at registration time (the
 * thread row exists — the spawner created it), read back by `fire` when the
 * registry has no claim (the post-reload path), and cleared after a
 * successful settlement so a settled bridge can never re-fire.
 */
export interface PersistedBridgeCoordinates {
  kind: 'sub-agent' | 'group-orchestration';
  memberAgentId?: string;
  messageContext?: ConversationContext;
  orchestrationOperationId?: string;
  parentContext?: ConversationContext;
  parentOperationId?: string;
  supervisorAgentId?: string;
  supervisorSnapshot?: SupervisorSnapshot;
  toolMessageId: string;
}
