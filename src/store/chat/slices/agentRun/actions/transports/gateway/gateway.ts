import {
  AgentStreamClient,
  type AgentStreamClientOptions,
  type AgentStreamEvent,
  type AgentStreamSessionCompletion,
  type ConnectionStatus,
} from '@lobechat/agent-gateway-client';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type {
  ChatTopicMetadata,
  ChatTopicStatus,
  ConversationContext,
  ExecAgentResult,
  MessageMetadata,
  RuntimeMentionedAgent,
} from '@lobechat/types';
import { resolveAgentAgencyConfig } from '@lobechat/types';

import { isDesktop } from '@/const/version';
import {
  ensureAgentManagementAccess,
  getRuntimeCanManageAgent,
} from '@/helpers/agentManagementAccess';
import { resolveExecutionTarget, resolveWorkspaceScoped } from '@/helpers/executionTarget';
import {
  aiAgentService,
  type ResumeApprovalParam,
  type ResumeToolResultParam,
} from '@/services/aiAgent';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { messageService } from '@/services/message';
import { shareChatService } from '@/services/shareChat';
import { topicService } from '@/services/topic';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { consumePendingTopicRepos, getPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { getFileStoreState } from '@/store/file/store';
import type { StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import {
  settingsSelectors,
  toolInterventionSelectors,
  userProfileSelectors,
} from '@/store/user/selectors';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { resolveNewThreadIntent } from '../../dispatch/newThreadIntent';
import { buildRunLifecycle } from '../../lifecycle/buildRunLifecycle';
import type { RunScope } from '../../lifecycle/types';
import { createGatewayEventBuffer } from './gatewayEventBuffer';
import { createGatewayEventHandler, isCompletedRuntimeEnd } from './gatewayEventHandler';
import { createGatewayEventRouter } from './gatewayEventRouter';
import { createGatewayMemberStreamHandler } from './gatewayMemberStreamHandler';

/**
 * Interrupts a gateway operation and rejects when its physical shutdown is unconfirmed.
 *
 * Device confirmation is authoritative for local heterogeneous agents because
 * their server runtime may already be absent while the native process still
 * needs to release its writer. Other runtimes fall back to the service result.
 */
const interruptGatewayTaskOrThrow = async (
  params: Parameters<typeof aiAgentService.interruptTask>[0],
): Promise<void> => {
  const result = await aiAgentService.interruptTask(params);
  const cancellationConfirmed = result.deviceCancellationConfirmed ?? result.success;

  if (!cancellationConfirmed) {
    throw new Error(
      `Gateway operation ${params.operationId ?? 'unknown'} cancellation unconfirmed`,
    );
  }
};

/**
 * When the agent runs against the local machine, resolve this desktop's
 * own gateway deviceId so it can be passed as the run's routing `deviceId` and
 * `localDeviceId` capability hint. The server then presets `activeDeviceId`,
 * injects `lobe-local-system` into the first LLM payload, and advertises direct
 * image reads only when the routed device still matches this desktop. This
 * skips the extra `activateDevice` round-trip the model is otherwise forced to
 * make whenever more than one device is online (with a single device the
 * server's heuristic already covered it).
 *
 * Gated on the effective runtime mode (`isLocalSystemEnabledById`), which
 * derives from `agencyConfig.executionTarget` — only a `local` target presets
 * the device. Resolving a device for `sandbox` / `none` / `device` targets
 * would wrongly route the run to this machine.
 *
 * Desktop-only and best-effort: any failure falls back to the server-side
 * device-resolution heuristics. We don't pre-check online status here — an
 * offline id simply fails the server's `onlineDevices` guard and stays unrouted.
 */
const resolveDesktopDeviceHints = async (
  agentId?: string,
): Promise<{ deviceId?: string; localDeviceId?: string }> => {
  if (!isDesktop || !agentId) return {};

  const agentState = getAgentStoreState();
  // Chat mode means "no execution environment" — never resolve a device, even
  // when the target is `local`. The server enforces this too (it auto-activates
  // a single online device), but skipping the deviceId round-trip here avoids
  // sending an id the server would only discard.
  if (chatConfigByIdSelectors.isChatModeById(agentId)(agentState)) return {};

  const agent = agentByIdSelectors.getAgentById(agentId)(agentState);
  const userState = useUserStore.getState();
  const currentUserId = userProfileSelectors.userId(userState);
  // Author-or-admin, mirroring the picker (`useAgentManagementAccess`) and the
  // server (`isResourceAuthorOrAdmin`) — an admin's own override must survive
  // a `fixed` selection policy just like the author's does. Resolve from the
  // server first when the picker's hook never primed the cache (cold load /
  // direct mention); no-op for authors and cached answers.
  await ensureAgentManagementAccess({
    agentId,
    agentUserId: agent?.userId,
    currentUserId,
    visibility: agent?.visibility,
    workspaceId: agent?.workspaceId,
  });
  const canManage = getRuntimeCanManageAgent({
    agentId,
    agentUserId: agent?.userId,
    currentUserId,
  });
  const usesWorkspaceMemberSelection =
    !!agent?.workspaceId && agent.visibility !== 'private' && !canManage;
  // Every workspace caller's override matters — a manager's / private owner's
  // `local` pick also lives in `agentDeviceOverrides` (the shared row must
  // never reference a personal device); `resolveAgentAgencyConfig` decides how
  // it applies per role.
  const deviceOverride = agent?.workspaceId
    ? userState.workspaceUserPreference.agentDeviceOverrides?.[agentId]
    : undefined;
  const agencyConfig = resolveAgentAgencyConfig(
    agentByIdSelectors.getAgencyConfigById(agentId)(agentState),
    deviceOverride,
    {
      canManage,
      visibility: agent?.visibility,
      workspaceId: agent?.workspaceId,
    },
  );
  const isPlatformTask = isRemoteHeterogeneousType(agencyConfig?.heterogeneousProvider?.type ?? '');
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: true,
    isHetero: !!agencyConfig?.heterogeneousProvider,
    workspaceScoped: resolveWorkspaceScoped(usesWorkspaceMemberSelection, deviceOverride),
  });
  // Platform hints are capability claims, not routing overrides. Always send
  // this desktop best-effort and let the server's authoritative execution plan
  // decide whether the effective target may consume it.
  if (!isPlatformTask && executionTarget !== 'local') return {};

  try {
    const info = await gatewayConnectionService.getDeviceInfo();
    if (!info?.deviceId) return {};
    return isPlatformTask
      ? { localDeviceId: info.deviceId }
      : { deviceId: info.deviceId, localDeviceId: info.deviceId };
  } catch {
    return {};
  }
};

type Setter = StoreSetter<ChatStore>;

// ─── Types ───

export interface GatewayConnection {
  client: Pick<
    AgentStreamClient,
    | 'connect'
    | 'disconnect'
    | 'on'
    | 'reconnect'
    | 'sendInterrupt'
    | 'sendToolResult'
    | 'updateToken'
  >;
  status: ConnectionStatus;
}

export interface ConnectGatewayParams {
  /**
   * Present on the agent-share visitor surface. Routes the `auth_expired`
   * token refresh through `shareChat.refreshGatewayToken` — the owner-scoped
   * refresh cannot see the creator-owned share topic.
   */
  agentShareId?: string;
  /**
   * Gateway WebSocket URL (e.g. https://agent-gateway.lobehub.com)
   */
  gatewayUrl: string;
  /**
   * Callback for each agent event received
   */
  onEvent?: (event: AgentStreamEvent) => void;
  /**
   * Called when the session completes (agent_runtime_end or session_complete).
   *
   * `succeeded` is true only for a clean `agent_runtime_end`; callers use it to
   * avoid stomping the `unread` status a background completion writes (the
   * completion's `markTopicUnread` and this terminal `active` write
   * partition the cases by `succeeded && !viewing`).
   *
   * `completion` identifies a raw session close versus an authoritative terminal
   * resume status. It is absent when auth failure or a terminal agent event drove
   * cleanup.
   *
   * `terminalReceived` is true when a terminal agent event (`agent_runtime_end` /
   * `error`) was processed — meaning the gateway event handler already completed
   * the op via the shared run lifecycle, so `onSessionComplete` is pure transport
   * cleanup. When false (terminal-missing: `session_complete` / `auth_failed` /
   * token-refresh failure arrived with no terminal agent event), the callback must
   * itself complete the op as the explicit fallback so it never sticks `running`.
   *
   * `authFailed` is true when the close was driven by the gateway rejecting auth
   * (`auth_failed`, or a failed `auth_expired` token refresh) — an authoritative
   * "this op no longer exists on the server" signal. Reconnect callers use it to
   * distinguish a genuinely-dead op (clear the persisted marker) from a bare
   * `resume_complete` terminal status, which can fire for a still-running op the
   * gateway DO has no live session for (e.g. heterogeneous CC) and must NOT clear.
   */
  onSessionComplete?: (info: {
    authFailed: boolean;
    completion?: AgentStreamSessionCompletion;
    succeeded: boolean;
    terminalReceived: boolean;
  }) => void;
  /**
   * The operation ID returned by execAgent
   */
  operationId: string;
  /**
   * Enable resume buffering for reconnect scenarios (default: false)
   */
  resumeOnConnect?: boolean;
  /**
   * Auth token for the Gateway
   */
  token: string;
  /**
   * Topic this op runs against. Used to refresh the Gateway JWT via
   * `aiAgentService.refreshGatewayToken(topicId)` when the server signals
   * `auth_expired`. Every Gateway op has a topic, so this is required.
   */
  topicId: string;
}

const isSuccessfulGatewayCompletion = (params: {
  authFailed: boolean;
  completion?: AgentStreamSessionCompletion;
  succeeded: boolean;
}): boolean =>
  params.succeeded ||
  (!params.authFailed &&
    params.completion?.source === 'resume_status' &&
    params.completion.status === 'completed');

// ─── Action Implementation ───

export class GatewayActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  /** Overridable factory for testing */
  createClient: (options: AgentStreamClientOptions) => GatewayConnection['client'] = (options) =>
    new AgentStreamClient(options);

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /**
   * Connect to the Agent Gateway for a specific operation.
   * Creates an AgentStreamClient, manages its lifecycle, and wires up event callbacks.
   */
  connectToGateway = (params: ConnectGatewayParams): void => {
    const {
      agentShareId,
      operationId,
      gatewayUrl,
      token,
      topicId,
      onEvent,
      onSessionComplete,
      resumeOnConnect,
    } = params;

    // Disconnect existing connection for this operation if any
    this.disconnectFromGateway(operationId);

    const client = this.createClient({ gatewayUrl, operationId, resumeOnConnect, token });

    // Track connection in store
    this.#set(
      (state) => ({
        gatewayConnections: {
          ...state.gatewayConnections,
          [operationId]: { client, status: 'connecting' },
        },
      }),
      false,
      'connectToGateway',
    );

    // Wire up status changes
    client.on('status_changed', (status) => {
      this.#set(
        (state) => {
          const conn = state.gatewayConnections[operationId];
          if (!conn) return state;
          return {
            gatewayConnections: { ...state.gatewayConnections, [operationId]: { ...conn, status } },
          };
        },
        false,
        'gateway/statusChanged',
      );
    });

    // Track whether a terminal agent event was received (agent_runtime_end or error),
    // so we can fire onSessionComplete from the subsequent disconnect.
    // session_complete is handled separately as an explicit server signal.
    let receivedTerminalEvent = false;
    let terminalSucceeded = false;
    let sessionCompleted = false;
    const eventBuffer = createGatewayEventBuffer((event) => onEvent?.(event));
    const fireSessionComplete = (opts?: {
      authFailed?: boolean;
      completion?: AgentStreamSessionCompletion;
    }) => {
      if (sessionCompleted) return;
      sessionCompleted = true;
      eventBuffer.flush();
      onSessionComplete?.({
        authFailed: opts?.authFailed ?? false,
        completion: opts?.completion,
        succeeded: terminalSucceeded,
        terminalReceived: receivedTerminalEvent,
      });
    };

    // Forward agent events to caller, and track terminal events.
    //
    // Only THIS op's terminal counts. On a multiplexed connection the
    // supervisor's WS also carries forwarded member terminals; a member
    // finishing must not mark the supervisor run complete or stomp its unread
    // status. Match on the event's operationId (absent ⇒ legacy single-op WS,
    // treat as this op's to preserve prior behavior).
    client.on('agent_event', (event) => {
      const isOwnOp = !event.operationId || event.operationId === operationId;
      if (isOwnOp && (event.type === 'agent_runtime_end' || event.type === 'error')) {
        receivedTerminalEvent = true;
      }
      // Only a clean completion counts as success — a cancel ('interrupted') or
      // deferred-tool park ('waiting_for_async_tool') must take the non-success
      // branch so onSessionComplete clears the run back to 'active' instead of
      // leaving the topic persisted as an unread completion.
      if (
        isOwnOp &&
        event.type === 'agent_runtime_end' &&
        isCompletedRuntimeEnd((event.data as { reason?: string } | undefined)?.reason)
      ) {
        terminalSucceeded = true;
      }
      eventBuffer.push(event);
    });

    // Handle session completion
    client.on('session_complete', (completion) => {
      this.internal_cleanupGatewayConnection(operationId);
      fireSessionComplete({ completion });
    });

    // Handle disconnection — only fire session complete if a terminal agent event
    // was received (agent_runtime_end / error). Explicit disconnect() and other
    // non-terminal disconnects should NOT trigger onSessionComplete.
    // (auth_failed is handled separately below — it's also session-terminal.)
    client.on('disconnected', () => {
      this.internal_cleanupGatewayConnection(operationId);
      if (receivedTerminalEvent) {
        fireSessionComplete();
      }
    });

    // Handle auth failures — server-side terminal: the op no longer exists on
    // the server (GC'd, token rejected, etc.), so the local op must be marked
    // complete. Without this, the local op stays `running` forever and the
    // input stop button never clears; worse, `topic.metadata.runningOperation`
    // never gets cleared either, so each revisit re-triggers the same broken
    // reconnect.
    client.on('auth_failed', (reason) => {
      console.error(`[Gateway] Auth failed for operation ${operationId}: ${reason}`);
      this.internal_cleanupGatewayConnection(operationId);
      fireSessionComplete({ authFailed: true });
    });

    // Handle expired-but-recoverable auth: the JWT is past `exp` but the op
    // is still alive on the server. Refresh the token, hand it to the client,
    // and reconnect. If the refresh itself fails (refresh API down, server
    // refused refresh, etc.), fall back to terminal — leaving the op
    // `running` would freeze the input. The server keeps the ws open after
    // `auth_expired` to give the client a chance to recover, so we must
    // explicitly `disconnect()` before completing — otherwise heartbeat and
    // autoReconnect would keep running past the local op's lifetime.
    client.on('auth_expired', async () => {
      try {
        const { token: fresh } = agentShareId
          ? await shareChatService.refreshGatewayToken(agentShareId, topicId)
          : await aiAgentService.refreshGatewayToken(topicId);
        client.updateToken(fresh);
        await client.reconnect();
      } catch (error) {
        console.error(`[Gateway] Token refresh failed for operation ${operationId}:`, error);
        client.disconnect();
        this.internal_cleanupGatewayConnection(operationId);
        // A rejected refresh means the gateway no longer accepts this op's token
        // — treat it like auth_failed so reconnect callers clear the stale marker.
        fireSessionComplete({ authFailed: true });
      }
    });

    client.connect();
  };

  /**
   * Disconnect from the Gateway for a specific operation.
   */
  disconnectFromGateway = (operationId: string): void => {
    const conn = this.#get().gatewayConnections[operationId];
    if (!conn) return;

    conn.client.disconnect();
    this.internal_cleanupGatewayConnection(operationId);
  };

  /**
   * Send an interrupt command to stop the agent for a specific operation.
   */
  interruptGatewayAgent = (operationId: string): void => {
    const conn = this.#get().gatewayConnections[operationId];
    if (!conn) return;

    conn.client.sendInterrupt();
  };

  /**
   * Get the connection status for a specific operation.
   */
  getGatewayConnectionStatus = (operationId: string): ConnectionStatus | undefined => {
    return this.#get().gatewayConnections[operationId]?.status;
  };

  /**
   * Check if Gateway mode is available and enabled.
   * Returns true when the server supports Gateway mode and the agent config
   * has not disabled it. `disableGatewayMode: undefined` means enabled.
   */
  isGatewayModeEnabled = (agentId?: string): boolean => {
    const serverConfig = window.global_serverConfigStore?.getState()?.serverConfig;
    const agentState = getAgentStoreState();
    const resolvedAgentId = agentId ?? agentState.activeAgentId;
    const agentDisableGatewayMode = resolvedAgentId
      ? chatConfigByIdSelectors.getChatConfigById(resolvedAgentId)(agentState).disableGatewayMode
      : undefined;
    const defaultDisableGatewayMode = settingsSelectors.defaultAgentConfig(useUserStore.getState())
      .chatConfig?.disableGatewayMode;
    const disableGatewayMode = agentDisableGatewayMode ?? defaultDisableGatewayMode;

    return (
      !!serverConfig?.agentGatewayUrl &&
      !!serverConfig.enableGatewayMode &&
      disableGatewayMode !== true
    );
  };

  /**
   * Execute agent task via Gateway WebSocket.
   * Call isGatewayModeEnabled() first to check availability.
   */
  /**
   * Execute agent task via Gateway WebSocket.
   * The backend creates user + assistant messages and the topic (if needed).
   * Returns the result so the caller can handle topic switching.
   */
  /**
   * Execute agent task via Gateway WebSocket.
   * The backend creates user + assistant messages and the topic (if needed),
   * then starts the agent. This method handles topic switching and WebSocket connection.
   */
  executeGatewayAgent = async (params: {
    /**
     * Client-minted ids for the rows this run creates (fresh sends only). The
     * server honours them verbatim, so the optimistic topic / message rows keep
     * their ids instead of diverging from the server-minted ones.
     */
    clientIds?: { assistantMessageId?: string; topicId?: string; userMessageId?: string };
    /** Agent/runtime context used to execute the server operation. */
    context: ConversationContext;
    /** File IDs of already-uploaded attachments to attach to the new user message */
    fileIds?: string[];
    message: string;
    /**
     * Conversation context that owns the rendered messages. Defaults to the
     * execution context. Sub-agent calls keep this on the parent conversation
     * while executing with the target agent from `context`.
     */
    messageContext?: ConversationContext;
    /** Request metadata carried from the originating user message. */
    metadata?: Pick<MessageMetadata, 'trigger'>;
    /** Called as soon as phase-1 returns with a persisted user message. */
    onMessageAccepted?: () => void;
    /** Called when the gateway session completes (agent finished running) */
    onComplete?: () => void;
    /** Temporary sidebar topic inserted by sendMessage before the server creates the real topic. */
    optimisticTopic?: { id: string; metadata?: ChatTopicMetadata; title: string };
    /** Parent message ID for regeneration/continue (skip user message creation, branch from this message) */
    parentMessageId?: string;
    /**
     * Operation already created by the generic intervention claim+dispatch
     * endpoint. The client adopts it here so streaming setup stays identical
     * without issuing a second legacy resume request.
     */
    precreatedResult?: ExecAgentResult;
    /** Server operation whose visible output ended before this fresh turn. */
    replacesOperationId?: string;
    /**
     * Caller-owned operation that should be completed once the gateway side
     * has finished phase-1 init (network round-trip + child
     * `execServerAgentRuntime` op started). Lets the caller keep its own
     * loading state running through `execAgentTask` without any gap before
     * the child op takes over. The relationship is also recorded as
     * parent/child lineage on the new op.
     */
    parentOperationId?: string;
    /**
     * Resume a paused op waiting on `human_approve_required`. Forwarded to
     * `aiAgentService.execAgentTask` so the new server-side op knows to apply
     * the user's decision to the target tool message instead of starting from
     * a fresh user prompt.
     */
    resumeApproval?: ResumeApprovalParam;
    /**
     * Batch form of `resumeApproval` — every decision made in one "approve all"
     * action. Forwarded so the server resolves the whole pending batch in a
     * single op instead of one op (and one LLM continuation) per tool.
     */
    resumeApprovals?: ResumeApprovalParam[];
    /**
     * Resume a paused op waiting on a human-intervention tool (e.g. lobe-agent
     * `askUserQuestion`). Forwarded to `aiAgentService.execAgentTask` so the new
     * server-side op writes the human answer as the tool result and resumes from
     * `phase: 'tool_result'` WITHOUT re-executing the tool.
     */
    resumeToolResult?: ResumeToolResultParam;
    /**
     * Tool identifiers the user @-mentioned in this message. Forwarded to the
     * server as `selectedToolIds` so the server runtime enables them for this
     * run (mirrors the client runtime's mention → callable-tool wiring). Lets a
     * user invoke a tool that isn't pinned to the agent (e.g. a custom MCP
     * connector picked from the @ list).
     */
    selectedToolIds?: string[];
    /**
     * Agents the user @-mentioned in this message (multi-mention). Forwarded to
     * the server so the supervisor run enables the callAgent tool and injects the
     * mentioned-agents delegation context — mirrors the client runtime's
     * `initialContext.mentionedAgents` + injected callAgent manifest. Without
     * this the gateway supervisor never sees the mention and answers itself
     * instead of delegating.
     */
    mentionedAgents?: RuntimeMentionedAgent[];
    /**
     * Temporary message IDs created during the initial sendMessage phase.
     * These are associated with the new gateway operation so the UI doesn't
     * show a blank loading state while waiting for the first `step_start`
     * event to call `replaceMessages` with the server's real message IDs.
     */
    tempMessageIds?: string[];
  }): Promise<ExecAgentResult> => {
    const {
      clientIds,
      context: executionContext,
      fileIds,
      message,
      messageContext = executionContext,
      metadata,
      onComplete,
      onMessageAccepted,
      optimisticTopic,
      parentMessageId,
      parentOperationId,
      precreatedResult,
      replacesOperationId,
      resumeApproval,
      resumeApprovals,
      resumeToolResult,
      selectedToolIds,
      mentionedAgents,
      tempMessageIds,
    } = params;

    const agentGatewayUrl =
      window.global_serverConfigStore!.getState().serverConfig.agentGatewayUrl!;

    // The EXECUTION context decides whether the server creates a topic. The
    // message context can already carry the client-minted topic id (the send
    // adopted it up front so the streamed messages land in the on-screen
    // bucket) while the topic still has no server row.
    const isCreateNewTopic = !executionContext.topicId;
    // "Start a new subtopic": the composer stages the thread client-side and the
    // server materialises it as part of this run. Without forwarding the intent
    // the turn persists onto the topic's main spine and the subtopic collapses
    // back into the main chat.
    const newThread = resolveNewThreadIntent(executionContext);
    const taskId =
      executionContext.viewedTask?.type === 'detail'
        ? executionContext.viewedTask.taskId
        : undefined;

    // If this is a new topic, read any repos the user pre-selected before
    // sending the first message. We read without consuming yet — if execAgentTask
    // fails or is aborted, the selection is preserved so a retry can still pick
    // it up. We clear only after the server confirms the topic was created.
    const pendingRepos =
      isCreateNewTopic && messageContext.agentId
        ? getPendingTopicRepos(messageContext.agentId)
        : [];
    // Pending repo selection wins; otherwise carry the caller-resolved topic
    // metadata (e.g. the hetero cwd `conversationLifecycle` resolved from the
    // effective device + per-user legacy slot) so the SERVER topic is born with
    // it — the server can't read client-local state, and without this a
    // workspace hetero run's first send would fall back to the device default
    // cwd instead of the member's pick.
    const initialTopicMetadata =
      pendingRepos.length > 0
        ? {
            repos: pendingRepos,
            workingDirectory: pendingRepos[0],
            workingDirectoryConfig: { path: pendingRepos[0], repoType: 'github' as const },
          }
        : isCreateNewTopic && optimisticTopic?.metadata?.workingDirectory
          ? {
              repos: optimisticTopic.metadata.repos,
              workingDirectory: optimisticTopic.metadata.workingDirectory,
              workingDirectoryConfig: optimisticTopic.metadata.workingDirectoryConfig,
            }
          : undefined;

    // Honour user-initiated cancel during phase-1 init: while we await the
    // execAgentTask round-trip the caller's loading state (e.g. `sendMessage`)
    // is still running, so the ChatInput stop button is active. Forward the
    // signal into the request so the fetch aborts in-flight. If the server has
    // already persisted the turn, interrupt generation but still reconcile the
    // message locally before returning.
    const abortSignal = parentOperationId
      ? this.#get().getOperationAbortSignal(parentOperationId)
      : undefined;

    const desktopDeviceHints = await resolveDesktopDeviceHints(executionContext.agentId);
    const userInterventionConfig = {
      approvalMode: toolInterventionSelectors.approvalMode(useUserStore.getState()),
      allowList: toolInterventionSelectors.allowList(useUserStore.getState()),
    };

    if (abortSignal?.aborted) {
      throw abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    // Agent-share visitor surface: dispatch through the share-authorized mirror.
    // It accepts only the share-safe subset (prompt / topic / clientIds) —
    // everything else (tools, devices, mentions) is decided server-side by the
    // share config, never by this client.
    const agentShareId = executionContext.agentShareId;

    const result =
      precreatedResult ??
      (agentShareId
        ? await shareChatService.execAgentTask(
            {
              clientIds,
              prompt: message,
              shareId: agentShareId,
              topicId: executionContext.topicId,
            },
            { signal: abortSignal },
          )
        : await aiAgentService.execAgentTask(
            {
              agentId: executionContext.agentId,
              // Fresh sends only — resume flows never pass this, and the server drops
              // it defensively on resume-like params anyway.
              clientIds,
              appContext: {
                agentDocumentId: executionContext.agentDocumentId,
                ...(messageContext.agentId !== executionContext.agentId && {
                  conversationAgentId: messageContext.agentId,
                }),
                defaultTaskAssigneeAgentId: executionContext.defaultTaskAssigneeAgentId,
                documentId: executionContext.documentId,
                // When AgentBuilder runs, context.agentId is the builtin builder agent.
                // The actual editing target is chatStore.activeAgentId (kept in sync by
                // AgentBuilderProvider). Pass it so the server can route tool calls to
                // the correct agent rather than the builder itself.
                ...(executionContext.scope === 'agent_builder' && {
                  editingAgentId: this.#get().activeAgentId ?? undefined,
                }),
                // Same shape as `editingAgentId`, for the Group Agent Builder panel on
                // the group Profile page. The builder conversation is keyed by the
                // builtin builder agent (no groupId in its ConversationContext, so the
                // message map key and the group's own chat stay separate), which left
                // the server runtime with no idea which group it was editing.
                // The context value wins, and every surface that opens this scope sets
                // it from its own route/group: it is fixed for the run, so a mid-run
                // navigation cannot make the server stamp a different group than the
                // panel is reading from. The `activeGroupId` fallback is a last resort
                // for a caller that forgot — it is sampled here, AFTER the async
                // preflight above, so it can already be stale by this point.
                ...(executionContext.scope === 'group_agent_builder' && {
                  editingGroupId: executionContext.editingGroupId ?? this.#get().activeGroupId,
                }),
                groupId: executionContext.groupId,
                ...(initialTopicMetadata && { initialTopicMetadata }),
                ...(newThread && { newThread }),
                // Forward the group orchestration role so the server can stamp it onto
                // the assistant message metadata. Without this the gateway-created
                // supervisor turn loses its role on the step_start snapshot / refetch
                // and renders as a generic assistant.
                orchestrationRole: executionContext.orchestrationRole,
                scope: executionContext.scope,
                taskId,
                threadId: executionContext.threadId,
                topicId: executionContext.topicId,
                // Goal-page side conversation: lets the server build the goal
                // overview injection for gateway-run agents (mirrors the client
                // streaming executor).
                viewedGoal: executionContext.viewedGoal,
              },
              ...desktopDeviceHints,
              fileIds,
              replacesOperationId,
              mentionedAgents,
              parentMessageId,
              prompt: message,
              resumeApproval,
              resumeApprovals,
              resumeToolResult,
              selectedToolIds,
              trigger: metadata?.trigger,
              userInterventionConfig,
            },
            { signal: abortSignal },
          ));

    // Persistence is the ownership boundary. Notify before later UI synchronization awaits and
    // before handling a late abort so callers never delete a file already attached server-side.
    try {
      onMessageAccepted?.();
    } catch (error) {
      console.error('[Gateway] onMessageAccepted callback failed:', error);
    }

    let hasInterruptedAfterPersistence = false;
    const interruptIfCancelledAfterPersistence = () => {
      if (!abortSignal?.aborted) return false;

      if (!hasInterruptedAfterPersistence) {
        hasInterruptedAfterPersistence = true;
        // Cancel arrived after execAgentTask resolved — server task exists. Interrupt generation,
        // but keep reconciling the persisted message before returning to the caller.
        // Share visitors have no access to the owner-scoped interrupt (and no
        // device runtimes to confirm), so they go through the share mirror.
        if (agentShareId)
          shareChatService
            .interruptTask(agentShareId, result.topicId, result.operationId)
            .catch((err) =>
              console.error('[Gateway] share interruptTask after cancel failed:', err),
            );
        else
          interruptGatewayTaskOrThrow({
            operationId: result.operationId,
            topicId: result.topicId,
          }).catch((err) => console.error('[Gateway] interruptTask after cancel failed:', err));
      }

      return true;
    };
    let cancelledAfterPersistence = interruptIfCancelledAfterPersistence();

    // Keep execution identity separate from the conversation bucket that owns
    // the streamed messages. They differ for callAgent/sub-agent runs.
    // Pivot the optimistic `thread_..._new` bucket onto the persisted thread the
    // server just created: with `threadId` set, `messageMapKey` ignores `isNew`
    // and both contexts resolve to the real thread key.
    const resolveThread = <T extends ConversationContext>(context: T): T =>
      result.createdThreadId
        ? { ...context, isNew: false, threadId: result.createdThreadId }
        : context;
    const resolvedExecutionContext = resolveThread({
      ...executionContext,
      topicId: result.topicId,
    });
    const resolvedMessageContext = resolveThread({ ...messageContext, topicId: result.topicId });
    this.#get().moveVoiceMessages(messageContext, resolvedMessageContext);

    if (result.createdThreadId) {
      // Attachments picked in the subtopic composer were staged under the
      // `_new` key; carry them over so the next turn in the thread still sees
      // them (mirrors the new-topic handoff below).
      getFileStoreState().moveChatContextSelections(
        messageMapKey(messageContext),
        messageMapKey(resolvedMessageContext),
      );

      // Seed the persisted-thread bucket from the server, exactly as the
      // new-topic branch below does. The Thread portal pivots to this key the
      // moment `portalThreadId` is set, and its own fetch resolves against a
      // thread that did not exist yet — so without this the panel renders the
      // parent context alone and the turn the user just sent is invisible until
      // something else revalidates. `execAgentTask` has already persisted both
      // rows by the time it returns, so this read is authoritative.
      try {
        const messages = await messageService.getMessages(resolvedMessageContext);
        this.#get().replaceMessages(messages, { context: resolvedMessageContext });
      } catch {
        /* non-critical */
      }
    }

    if (!isCreateNewTopic && cancelledAfterPersistence) {
      try {
        const messages = await messageService.getMessages(resolvedMessageContext);
        this.#get().replaceMessages(messages, { context: resolvedMessageContext });
      } catch {
        /* non-critical */
      }
    }

    if (isCreateNewTopic && result.topicId) {
      // Topic created successfully — now safe to clear the pending repo selection.
      if (messageContext.agentId) consumePendingTopicRepos(messageContext.agentId);
      if (optimisticTopic) {
        const topicMetadata = optimisticTopic.metadata ?? initialTopicMetadata;
        this.#get().internal_replaceTopicId({
          agentId: messageContext.agentId,
          groupId: messageContext.groupId,
          nextId: result.topicId,
          previousId: optimisticTopic.id,
          value: {
            ...(topicMetadata ? { metadata: topicMetadata } : {}),
            ...(messageContext.groupId ? {} : { sessionId: messageContext.agentId }),
            title: optimisticTopic.title,
          },
        });
        getFileStoreState().moveChatContextSelections(
          messageMapKey({ ...messageContext, topicId: optimisticTopic.id }),
          messageMapKey({ ...messageContext, topicId: result.topicId }),
        );
      }
      try {
        const messages = await messageService.getMessages(resolvedMessageContext);
        this.#get().replaceMessages(messages, { context: resolvedMessageContext });
      } catch {
        /* non-critical */
      }

      await this.#get().switchTopic(result.topicId, {
        clearNewKey: true,
        skipRefreshMessage: true,
      });

      // Refresh the topic list so the new topic appears in topicDataMap (sidebar).
      // Unlike the direct-API sendMessage path (which receives topics[] in the
      // response and calls internal_updateTopics), the gateway path only gets a
      // topicId — we must explicitly refetch so the sidebar shows the new topic.
      // Share visitors have no owner topic sidebar — their list refreshes via
      // the share feature's own SWR hook, and refreshTopic is owner-scoped.
      if (!agentShareId)
        this.#get()
          .refreshTopic()
          .catch((err) =>
            console.error('[Gateway] refreshTopic after topic creation failed:', err),
          );
    }

    this.#get().moveQueuedMessages(
      messageMapKey(messageContext),
      messageMapKey(resolvedMessageContext),
    );
    // Legacy queue location: follow-ups enqueued behind an op still registered
    // under the pre-mint `_new` key.
    if (isCreateNewTopic)
      this.#get().moveQueuedMessages(
        messageMapKey({ ...messageContext, topicId: null }),
        messageMapKey(resolvedMessageContext),
      );
    cancelledAfterPersistence = interruptIfCancelledAfterPersistence() || cancelledAfterPersistence;

    if (cancelledAfterPersistence) {
      if (parentOperationId) this.#get().completeOperation(parentOperationId);
      return result;
    }

    // `updateTopicStatus` persists through the owner-scoped `topic.updateTopic`
    // procedure, which a share visitor is never authorized to call — firing it
    // would only produce a rejected request (and a pinned optimistic write that
    // no owner topic list ever consumes).
    if (result.topicId && !agentShareId) {
      void this.#get().updateTopicStatus?.({
        agentId: messageContext.agentId,
        groupId: messageContext.groupId,
        status: 'running',
        topicId: result.topicId,
      });
    }

    // Create a dedicated operation for gateway execution with correct context.
    // Stash the server operation id in metadata so human-intervention flows
    // (approve/reject/reject_continue) can look it up and call the server
    // without needing an out-of-band lookup.
    const { operationId: gatewayOpId } = this.#get().startOperation({
      context: resolvedMessageContext,
      metadata: { serverOperationId: result.operationId },
      parentOperationId,
      type: 'execServerAgentRuntime',
    });

    // Associate the server-created assistant message with the gateway operation
    this.#get().associateMessageWithOperation(result.assistantMessageId, gatewayOpId);

    // Also associate temp message IDs so the UI doesn't show a blank loading
    // state while waiting for the first `step_start` event to call
    // `replaceMessages` with the server's real message IDs.
    if (tempMessageIds?.length) {
      for (const tempId of tempMessageIds) {
        this.#get().associateMessageWithOperation(tempId, gatewayOpId);
      }
    }

    // Phase-1 init done: child op is running. Hand off loading state from
    // the caller's op (e.g. `sendMessage`) to the child without a gap.
    if (parentOperationId) this.#get().completeOperation(parentOperationId);

    // Optimistically update the local store's runningOperation for this topic so
    // useGatewayReconnect doesn't fire for a stale previous operation while the new
    // gateway connection is being established. Also disconnect any live reconnect
    // connection that was already established for the old operation.
    if (result.topicId) {
      const existingTopic = topicSelectors.getTopicById(result.topicId)(this.#get());
      const staleOpId = existingTopic?.metadata?.runningOperation?.operationId;
      if (staleOpId && staleOpId !== result.operationId) {
        this.#get().internal_dispatchTopic({
          id: result.topicId,
          type: 'updateTopic',
          value: {
            metadata: {
              ...existingTopic?.metadata,
              runningOperation: {
                assistantMessageId: result.assistantMessageId,
                heteroType: result.heteroType,
                operationId: result.operationId,
              },
            },
          },
        });
        this.disconnectFromGateway(staleOpId);
      }
    }

    // When the local operation is cancelled (e.g. user clicks stop), forward
    // the interrupt directly to the server via the existing tRPC endpoint.
    // Closure captures `result.operationId` (the server-side id) so we don't
    // depend on any metadata lookup. The returned promise preserves an
    // unconfirmed device shutdown so Send now can keep its queued message.
    this.#get().onOperationCancel(gatewayOpId, async () => {
      if (agentShareId) {
        await shareChatService
          .interruptTask(agentShareId, result.topicId, result.operationId)
          .catch((err) => console.error('[Gateway] share interruptTask failed:', err));
        return;
      }

      await interruptGatewayTaskOrThrow({
        operationId: result.operationId,
        topicId: result.topicId,
      });
    });

    const eventHandler = createGatewayEventHandler(this.#get, {
      assistantMessageId: result.assistantMessageId,
      context: resolvedMessageContext,
      // Server-side operation id — needed for tool_result dispatch back over
      // the same WS that gatewayConnections is keyed on.
      gatewayOperationId: result.operationId,
      operationId: gatewayOpId,
      // Shared run lifecycle: drives the terminal completeRun / afterRunComplete
      // for the gateway transport (op completion + unread + queue drain +
      // notification) at `agent_runtime_end` / `error`.
      runLifecycle: buildRunLifecycle(this.#get, {
        context: resolvedMessageContext,
        parentMessageId: result.assistantMessageId,
        parentMessageType: 'assistant',
        runId: gatewayOpId,
        runScope: (resolvedExecutionContext.scope === 'sub_agent'
          ? 'sub_agent'
          : 'top_level') as RunScope,
        runtimeType: 'gateway',
      }),
    });

    // Demux the supervisor's WebSocket: with single-connection multiplexing
    // this WS also carries each broadcast member's streaming events (forwarded
    // server-side onto the supervisor op channel). Route owner events to the
    // full handler and member events to render-only member handlers so a
    // member's chunks stream into its own council column instead of corrupting
    // the supervisor bubble.
    const eventRouter = createGatewayEventRouter({
      createMemberHandler: this.buildMemberHandlerFactory(resolvedMessageContext, gatewayOpId),
      ownerHandler: eventHandler,
      ownerOperationId: result.operationId,
    });

    this.#get().connectToGateway({
      gatewayUrl: agentGatewayUrl,
      onEvent: eventRouter,
      onSessionComplete: ({ authFailed, completion, succeeded, terminalReceived }) => {
        // The gateway event handler already completed the op via the shared run
        // lifecycle on `agent_runtime_end` / `error`. Only complete here as the
        // terminal-missing fallback so the op never sticks `running`.
        if (!terminalReceived) this.#get().completeOperation(gatewayOpId);

        // A terminal resume status is ambiguous only for an external hetero
        // producer: an older or degraded Gateway may have no initialized DO
        // session while the CLI is still alive and streaming via heteroIngest.
        // Preserve unknown (`undefined`) during rolling deploys; new normal
        // runtimes explicitly return `heteroType: null`. A raw session_complete,
        // real terminal event, or auth failure remains authoritative.
        const preserveExternalProducer =
          !terminalReceived &&
          !authFailed &&
          completion?.source === 'resume_status' &&
          result.heteroType !== null;
        if (preserveExternalProducer) return;

        const effectiveSucceeded = isSuccessfulGatewayCompletion({
          authFailed,
          completion,
          succeeded,
        });

        if (result.topicId) {
          // The server already settled this topic: the runtime's `finish`
          // executor settles to 'unread' before it publishes the terminal event
          // this callback rides on, so by now the mark is legitimately gone and
          // a settle from here would only ever return 'missing'.
          //
          // What the server could NOT know is whether the user is watching. The
          // settle below performs that correction with the completed operation
          // id: after the marker is gone, the model only accepts unread → active
          // when `lastSettledOperationId` still matches. It also remains the
          // backstop when `clearRunningMark` failed and left the marker in place.
          const viewing = this.#get().activeTopicId === result.topicId;
          // Share visitors cannot settle the creator-owned topic row (the topic
          // router is owner-scoped) — the local clear below still runs.
          if (!agentShareId)
            topicService
              .settleRunningOperation(
                result.topicId,
                result.operationId,
                viewing || !effectiveSucceeded ? 'active' : 'unread',
              )
              .catch(console.error);
          // Also clear the local store copy — the server settle above does NOT
          // touch the Zustand topic map that useGatewayReconnect (and the sidebar
          // spinner) read. Mirror the same 'active' decision passed to the server
          // call above; omit it for the unwatched-clean-completion case, which
          // `markTopicUnread` owns. Ownership-guarded on its own (see
          // clearLocalRunningOperation), so it is safe to call either way.
          this.clearLocalRunningOperation({
            agentId: resolvedMessageContext.agentId,
            groupId: resolvedMessageContext.groupId,
            operationId: result.operationId,
            status: viewing || !effectiveSucceeded ? 'active' : undefined,
            topicId: result.topicId,
          });
        }
        onComplete?.();
      },
      agentShareId,
      operationId: result.operationId,
      token: result.token || '',
      topicId: result.topicId,
    });

    return result;
  };

  /**
   * Reconnect to an existing Gateway operation after page reload.
   * Reads runningOperation from topic metadata, refreshes the JWT token,
   * and establishes a new WebSocket connection with event replay.
   */
  reconnectToGatewayOperation = async (params: {
    /**
     * Agent that owns the rendered conversation. Callers outside the agent route
     * (task detail / home run drawer) MUST pass it: `activeAgentId` is whatever
     * the last agent page left behind — `undefined` on the home surface — and the
     * streamed messages would land in a `main_undefined_<topicId>` bucket nobody
     * renders, leaving a connected-but-frozen panel.
     */
    agentId?: string;
    /**
     * Present on the agent-share visitor surface. Routes the token refresh and
     * cancellation through the share-authorized `shareChat` procedures instead
     * of the owner-scoped ones: a visitor has no owner-scoped access to the
     * creator's topic/operation rows, and the Gateway channel is registered
     * under the VISITOR's id, so only a visitor-signed token can reconnect it
     * — see `shareChat.refreshGatewayToken`'s JSDoc.
     */
    agentShareId?: string;
    assistantMessageId: string;
    heteroType?: string | null;
    operationId: string;
    scope?: string;
    threadId?: string | null;
    topicId: string;
  }): Promise<void> => {
    const { agentShareId, assistantMessageId, heteroType, operationId, topicId, scope, threadId } =
      params;

    const agentGatewayUrl =
      window.global_serverConfigStore?.getState()?.serverConfig?.agentGatewayUrl;
    if (!agentGatewayUrl) return;

    // Skip reconnect if the gateway action already established (or is establishing)
    // a fresh connection for this operation. This prevents a race on new-topic creation
    // where switchTopic loads runningOperation → useGatewayReconnect fires → overwrites
    // the connectToGateway call made by executeGatewayAgent with resumeOnConnect: true,
    // causing the gateway to treat a brand-new session as a resume → stuck / no events.
    // Any status other than 'disconnected' means the gateway action already owns this
    // connection (connecting / authenticating / reconnecting / connected). Skip to avoid
    // overwriting the fresh non-resume connect with resumeOnConnect:true.
    const existingStatus = this.#get().gatewayConnections[operationId]?.status;
    if (existingStatus && existingStatus !== 'disconnected') return;

    // Skip reconnect if the topic already has a newer running operation. This
    // happens when executeGatewayAgent was called (creating a new op) while this
    // stale reconnect was still queued — connecting to the old op would produce
    // duplicate streaming events alongside the new connection.
    const topicCurrentOpId = topicSelectors.getTopicById(topicId)(this.#get())?.metadata
      ?.runningOperation?.operationId;
    if (topicCurrentOpId && topicCurrentOpId !== operationId) return;

    // Get a fresh JWT token (original expired after 5 min). The server throws
    // TRPCError NOT_FOUND when it has no running operation on this topic — our
    // local marker is stale (e.g. an error run cleared the server marker but not
    // the store). Clear it and bail silently so the reconnect SWR fetcher resolves
    // and does not retry the 404 forever.
    let token: string;
    try {
      // Share visitors have no owner-scoped access to `aiAgentService.refreshGatewayToken`
      // (its TopicModel is scoped to the caller, and share topics belong to the
      // creator) — see the param JSDoc above for why the visitor mirror is used instead.
      ({ token } = agentShareId
        ? await shareChatService.refreshGatewayToken(agentShareId, topicId)
        : await aiAgentService.refreshGatewayToken(topicId));
    } catch (error) {
      if (isTrpcErrorCode(error, 'NOT_FOUND')) {
        this.clearLocalRunningOperation({ operationId, topicId });
        return;
      }
      throw error;
    }

    // Re-check after the async token refresh: a newer executeGatewayAgent call may have
    // taken over for this topic while we were waiting. If so, bail to avoid a duplicate stream.
    // (disconnectFromGateway on the stale op is a no-op here because we haven't connected yet.)
    const topicOpIdAfterRefresh = topicSelectors.getTopicById(topicId)(this.#get())?.metadata
      ?.runningOperation?.operationId;
    if (topicOpIdAfterRefresh && topicOpIdAfterRefresh !== operationId) return;

    const agentId = params.agentId ?? this.#get().activeAgentId;
    // Carry agentShareId the same way executeGatewayAgent's execution context
    // does — `createGatewayEventHandler` branches on `context.agentShareId` to
    // skip owner-only side effects (agent-signal emission, message.update on
    // error), and this context otherwise matches the one
    // ReadOnlyConversationArea.tsx builds ({ agentId, agentShareId, scope:
    // 'main', topicId }) for the visitor-rendered bucket.
    const context = {
      agentId,
      ...(agentShareId && { agentShareId }),
      scope: (scope ?? 'main') as ConversationContext['scope'],
      threadId: threadId ?? null,
      topicId,
    };

    // Anchor the operation to the run's real start: the assistant message was
    // created when the run began. Defaulting to Date.now() here would reset
    // elapsed-time displays (OpStatusTray) to zero on every page refresh.
    const assistantMessage = Object.values(this.#get().messagesMap)
      .flat()
      .find((m) => m.id === assistantMessageId);

    // `createdAt` is typed as a number but, after a DB rehydrate, it can arrive
    // as a Date / ISO string (the message service casts rows `as unknown` without
    // converting). Normalize to epoch ms here so the elapsed-time math stays a
    // number — passing a string/Invalid Date straight through makes
    // `Date.now() - startTime` resolve to NaN and renders as "NaN:NaN".
    const startTime = assistantMessage?.createdAt
      ? new Date(assistantMessage.createdAt).getTime()
      : undefined;

    // Create a local operation for UI loading state, stashing the server op id
    // so intervention flows can find it after reconnect as well.
    const { operationId: gatewayOpId } = this.#get().startOperation({
      context,
      metadata: {
        serverOperationId: operationId,
        ...(Number.isFinite(startTime) ? { startTime } : {}),
      },
      type: 'execServerAgentRuntime',
    });

    this.#get().associateMessageWithOperation(assistantMessageId, gatewayOpId);

    // Forward local-op cancellation to the server-side agent loop via tRPC.
    // See note in executeGatewayAgent for details.
    this.#get().onOperationCancel(gatewayOpId, async () => {
      // Share visitors have no access to the owner-scoped interrupt (and no
      // device runtimes to confirm), so they go through the share mirror —
      // same split as executeGatewayAgent's cancel path.
      if (agentShareId) {
        await shareChatService
          .interruptTask(agentShareId, topicId, operationId)
          .catch((err) => console.error('[Gateway] share interruptTask failed:', err));
        return;
      }

      await interruptGatewayTaskOrThrow({ operationId });
    });

    const eventHandler = createGatewayEventHandler(this.#get, {
      assistantMessageId,
      context,
      // Server-side operation id — needed for tool_result dispatch back over
      // the same WS that gatewayConnections is keyed on.
      gatewayOperationId: operationId,
      operationId: gatewayOpId,
      runLifecycle: buildRunLifecycle(this.#get, {
        context,
        parentMessageId: assistantMessageId,
        parentMessageType: 'assistant',
        runId: gatewayOpId,
        runScope: (context.scope === 'sub_agent' ? 'sub_agent' : 'top_level') as RunScope,
        runtimeType: 'gateway',
      }),
    });

    // Same demux as the initial-run path: a reconnected supervisor WS can also
    // receive forwarded member events, so route them away from the supervisor
    // handler (and stream them when the reconnect context carries the group).
    const eventRouter = createGatewayEventRouter({
      createMemberHandler: this.buildMemberHandlerFactory(context, gatewayOpId),
      ownerHandler: eventHandler,
      ownerOperationId: operationId,
    });

    this.#get().connectToGateway({
      gatewayUrl: agentGatewayUrl,
      onEvent: eventRouter,
      onSessionComplete: ({ authFailed, completion, succeeded, terminalReceived }) => {
        // A reconnect-local operation has no remaining work once the session
        // completion callback fires. Real streamed terminals are completed by
        // the shared run lifecycle; every terminal-missing fallback (including
        // the preserved external producer case below) must close it here.
        if (!terminalReceived) this.#get().completeOperation(gatewayOpId);

        // A reconnect is passive. Preserve only an external/rolling-unknown
        // producer whose terminal resume status may mean "Gateway session was
        // never initialized" rather than "producer ended". New normal runtime
        // markers carry `heteroType: null`; old markers omit the field, so the
        // rolling-deploy fallback is deliberately fail-safe. Raw session_complete,
        // terminal events and auth failures are authoritative and settle below.
        const preserveExternalProducer =
          !terminalReceived &&
          !authFailed &&
          completion?.source === 'resume_status' &&
          heteroType !== null;
        if (preserveExternalProducer) {
          return;
        }

        const effectiveSucceeded = isSuccessfulGatewayCompletion({
          authFailed,
          completion,
          succeeded,
        });

        // Same supersede guard as executeGatewayAgent's onSessionComplete: a
        // newer run may own this topic by now, and the settle below would
        // retire it mid-flight.
        const superseded = this.#isSupersededRunningOperation({
          agentId: context.agentId,
          operationId,
          topicId,
        });

        // Settle through the server exactly as executeGatewayAgent's
        // onSessionComplete does: ONE call that clears the marker and writes the
        // terminal status inside the topic row lock, comparing the operation id
        // so a late close from another tab cannot settle a newer run.
        //
        // This was hand-rolled here as two independent fire-and-forget writes: an
        // UNCONDITIONAL `updateTopicMetadata({ runningOperation: null })` plus an
        // `updateTopicStatus('active')` that was SKIPPED whenever the run finished
        // cleanly while the user was on another topic. That case delegated the
        // status write to `markTopicUnread` — a separate call, on a separate
        // guard — and when it did not land the topic stayed `running` forever:
        // the marker was already gone, so every later `settleRunningOperation`
        // returned `missing` and nothing on the server could repair it. Observed
        // on a self-hosted deployment as 7 topics stuck `running` whose
        // `metadata.runningOperation` was present-and-JSON-null (the signature of
        // that unconditional clear) with their operation rows already terminal.
        //
        // Reconnect is the path a page refresh takes, which is why the symptom
        // was always "still spinning after a reload" — refreshing is what moved
        // the run off the primary path and onto this one.
        const viewing = this.#get().activeTopicId === topicId;
        // Share visitors cannot settle the creator-owned topic row (the topic
        // router is owner-scoped) — the local clear below still runs. Same
        // split as executeGatewayAgent's onSessionComplete.
        if (!superseded && !agentShareId) {
          topicService
            .settleRunningOperation(
              topicId,
              operationId,
              viewing || !effectiveSucceeded ? 'active' : 'unread',
            )
            .catch(console.error);
        }
        // Mirror into the local store — the server settle does NOT touch the
        // Zustand topic map that useGatewayReconnect (and the sidebar spinner)
        // read. Status omitted for the unwatched-clean case, which
        // `markTopicUnread` owns locally; same split as the primary path.
        this.clearLocalRunningOperation({
          agentId: context.agentId,
          operationId,
          status: viewing || !effectiveSucceeded ? 'active' : undefined,
          topicId,
        });
      },
      agentShareId,
      operationId,
      resumeOnConnect: true,
      token,
      topicId,
    });
  };

  /**
   * Build the `createMemberHandler` factory for a run's event router, with a
   * single memoized group-tree hydration shared across all of that run's member
   * handlers. The first member to stream triggers one `getMessages` +
   * `replaceMessages` so the canonical council structure (the `agentCouncil` tool
   * message + every member row) lands — which is what makes the members render as
   * parallel columns rather than a stack — and concurrent members reuse the same
   * promise instead of each re-replacing the bucket and clobbering live content.
   */
  private buildMemberHandlerFactory = (
    context: ConversationContext,
    parentOperationId: string,
  ): ((memberOperationId: string) => (event: AgentStreamEvent) => void) => {
    let hydration: Promise<void> | undefined;
    const ensureGroupHydrated = () => {
      if (!hydration) {
        hydration = messageService
          .getMessages(context)
          .then((messages) => {
            this.#get().replaceMessages(messages, { context });
          })
          .catch(() => {});
      }
      return hydration;
    };

    return (memberOperationId: string) =>
      createGatewayMemberStreamHandler(this.#get, {
        context,
        ensureGroupHydrated,
        memberOperationId,
        parentOperationId,
      });
  };

  /**
   * Clear the client-store copy of `topic.metadata.runningOperation`.
   *
   * The server-side clear (`topicService.settleRunningOperation`, which nulls the
   * marker inside the topic row lock) alone leaves the Zustand store stale: `useGatewayReconnect` keys off the LOCAL
   * copy, so after an error run (e.g. insufficient credits) the stale marker keeps
   * firing `aiAgentService.refreshGatewayToken(topicId)`, which the server now answers
   * with NOT_FOUND (404 — the server-side marker is already null). Raw SWR retries the
   * 404 forever and wedges the conversation.
   *
   * The `updateTopic` reducer shallow-merges `value.metadata` (`{...currentTopic, ...value}`),
   * so we spread the existing metadata to avoid dropping its other keys. Only dispatch when
   * the topic still carries the marker for `operationId` — a late close of a finished op
   * can race with a retry/send that already wrote a NEWER operation's marker, and clearing
   * unconditionally would break reconnect-after-reload for that live run.
   *
   * `agentId`/`groupId` route the lookup + dispatch to the run's OWNING topic bucket
   * (same convention as `updateTopicStatus`): a background completion can land after the
   * user switched agent/group, when the active-bucket `getTopicById` would miss the topic
   * and leave its marker stale.
   */
  /**
   * Whether a DIFFERENT run has since claimed this topic's `runningOperation`.
   *
   * Read from the local topic map, which every run's start writes optimistically
   * — so a session closing after a newer run began can tell "my run ended" from
   * "the topic is idle" and keep its hands off the newer run's markers.
   *
   * Deliberately false when the topic carries no marker at all (not loaded into
   * `topicDataMap`, or already cleared): there is nothing to protect, and the
   * caller's clear must still run so a dead marker never survives.
   */
  #isSupersededRunningOperation = (params: {
    agentId?: string;
    groupId?: string;
    operationId: string;
    topicId: string;
  }): boolean => {
    const { agentId, groupId, operationId, topicId } = params;
    const state = this.#get();
    const key = topicMapKey({
      agentId: agentId ?? state.activeAgentId,
      groupId: groupId ?? state.activeGroupId,
    });
    const owner = state.topicDataMap[key]?.items?.find((t) => t.id === topicId)?.metadata
      ?.runningOperation?.operationId;

    return !!owner && owner !== operationId;
  };

  private clearLocalRunningOperation = (params: {
    agentId?: string;
    groupId?: string;
    operationId: string;
    /**
     * Mirror the topic's terminal status into the local Zustand copy alongside
     * the metadata clear. Omit for the "clean completion, not watching" case —
     * that one is owned by `markTopicUnread` elsewhere.
     */
    status?: ChatTopicStatus;
    topicId: string;
  }): void => {
    const { topicId, operationId, agentId, groupId, status } = params;
    const state = this.#get();
    const key = topicMapKey({
      agentId: agentId ?? state.activeAgentId,
      groupId: groupId ?? state.activeGroupId,
    });
    const existingTopic = state.topicDataMap[key]?.items?.find((t) => t.id === topicId);
    // Same ownership guard the removed client-side `superseded` check used to
    // provide: if a newer run already overwrote this topic's local marker with
    // its own operationId, this stale session's completion must not clobber it
    // (neither the metadata clear nor, now, the status write).
    if (existingTopic?.metadata?.runningOperation?.operationId !== operationId) return;

    state.internal_dispatchTopic({
      agentId,
      groupId,
      id: topicId,
      type: 'updateTopic',
      value: { metadata: { ...existingTopic.metadata, runningOperation: null } },
    });

    // Routed through `internal_pinTopicStatus`, not a bare dispatch: it also
    // registers the pending-write pin so a topic-list refetch racing in
    // behind this (e.g. within the 15s window of the 'running' pin set at
    // run start) reconciles to this status instead of reapplying the stale
    // 'running' one and stranding the spinner again.
    if (status) {
      state.internal_pinTopicStatus?.({ agentId, groupId, status, topicId });
    }
  };

  private internal_cleanupGatewayConnection = (operationId: string): void => {
    this.#set(
      (state) => {
        const { [operationId]: _, ...rest } = state.gatewayConnections;
        return { gatewayConnections: rest };
      },
      false,
      'gateway/cleanup',
    );
  };
}

export type GatewayAction = Pick<GatewayActionImpl, keyof GatewayActionImpl>;
