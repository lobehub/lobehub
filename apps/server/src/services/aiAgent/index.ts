import type { AgentState } from '@lobechat/agent-runtime';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { SandboxStorageClaim } from '@lobechat/builtin-tool-cloud-sandbox';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  AgentSenderMetadata,
  ExecAgentResult,
  ExecGroupAgentParams,
  ExecGroupAgentResult,
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
  ScheduleAgentRunParams,
  ScheduleAgentRunResult,
} from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { AgentShareModel } from '@/database/models/agentShare';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { DeviceModel } from '@/database/models/device';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TaskModel } from '@/database/models/task';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { AgentService } from '@/server/services/agent';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import type {
  AgentExecutionParams,
  AgentExecutionResult,
  AgentRuntimeServiceOptions,
  AgentStepContinuation,
  SubAgentBridgeParams,
} from '@/server/services/agentRuntime';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import type {
  ExecGroupMemberParams,
  ExecGroupMemberResult,
  GroupActionMemberBridgeParams,
} from '@/server/services/agentRuntime/types';
import { ComposioService } from '@/server/services/composio';
import { MarketService } from '@/server/services/market';

import { createGraphAwareAgentFactory } from './helpers/agentFactory';
import { InterventionController } from './intervention/InterventionController';
import type { ApprovalClaimState } from './pipeline/approvalResume';
import { execAgentTurn, type ExecAgentTurnDeps } from './pipeline/execTurn';
import {
  createGroupMemberApprovalDeps,
  rearmGroupMemberDeadline,
  resolveGroupMemberApprovalContinuation,
} from './pipeline/groupMemberApproval';
import { resolveNewThread } from './pipeline/newThread';
import { createGroupAgentTopic, type PrecreatedTopicDeps } from './pipeline/precreatedTopic';
import { scheduleAgentRun } from './pipeline/scheduleAgentRun';
import { runWithTopicStart, type TopicStartDeps } from './pipeline/topicStart';
import type { RunFacts } from './runFacts';
import { resolveAgentSenderFromOperation } from './sourceAttribution';
import type { SubAgentLlmRelayRequest } from './subAgentLlmRelay';
import { closeSubAgentLlmRelay, openSubAgentLlmRelay } from './subAgentLlmRelay';
import type { SubAgentRunDeps } from './subAgentRuns';
import { execAgentMember, execAgentThreadRun, execIsolatedAgentMember } from './subAgentRuns';
import type { InternalExecAgentParams } from './types';

const log = debug('lobe-server:ai-agent-service');

/**
 * AI Agent Service
 *
 * Encapsulates agent execution logic that can be triggered via:
 * - tRPC router (aiAgent.execAgent)
 * - REST API endpoint (/api/agent)
 * - Cron jobs / scheduled tasks
 */
export class AiAgentService {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly agentDocumentsService: AgentDocumentsService;
  private readonly agentModel: AgentModel;
  private readonly agentOperationModel: AgentOperationModel;
  private readonly agentService: AgentService;
  private readonly messageModel: MessageModel;
  private readonly connectorModel: ConnectorModel;
  private readonly connectorToolModel: ConnectorToolModel;
  private readonly pluginModel: PluginModel;
  private readonly taskModel: TaskModel;
  private readonly threadModel: ThreadModel;
  private readonly topicModel: TopicModel;
  private readonly agentRuntimeService: AgentRuntimeService;
  private readonly interventionController: InterventionController;
  private _marketService?: MarketService;
  private readonly composioService: ComposioService;

  private readonly workspaceId?: string;
  /**
   * When the caller authenticated with a restricted API key, the unrestricted
   * user JWT minted for gateway WebSocket auth must not be handed back — it
   * passes `oidcAuth` as non-API-key auth and would bypass the scope guard
   * entirely.
   */
  private readonly withholdGatewayToken: boolean;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    options?: {
      /**
       * Opt IN to agent-share visitor rows for the models this service (and
       * the {@link AgentRuntimeService} it constructs) owns. Reserved for
       * share-runtime entry points that drive a visitor turn under the
       * creator's `userId` (`share.ownerId`). Defaults to false; ordinary
       * creator-facing entry points get the visitor exclusion for free.
       */
      includeShareVisitor?: boolean;
      marketAccessToken?: string;
      runtimeOptions?: AgentRuntimeServiceOptions;
      withholdGatewayToken?: boolean;
      workspaceId?: string;
    },
  ) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = options?.workspaceId;
    this.withholdGatewayToken = options?.withholdGatewayToken ?? false;
    const wsId = this.workspaceId;
    const includeShareVisitor = options?.includeShareVisitor ?? false;
    const messageModelOptions = { includeShareVisitor };
    const topicModelOptions = { includeShareVisitor };
    this.agentDocumentsService = new AgentDocumentsService(db, userId, wsId);
    this.agentModel = new AgentModel(db, userId, wsId);
    this.agentOperationModel = new AgentOperationModel(db, userId, wsId);
    this.agentService = new AgentService(db, userId, wsId);
    this.messageModel = new MessageModel(db, userId, wsId, undefined, messageModelOptions);
    this.connectorModel = new ConnectorModel(db, userId, wsId);
    this.connectorToolModel = new ConnectorToolModel(db, userId, wsId);
    this.pluginModel = new PluginModel(db, userId, wsId);
    this.taskModel = new TaskModel(db, userId, wsId);
    this.threadModel = new ThreadModel(db, userId, wsId);
    this.topicModel = new TopicModel(db, userId, wsId, undefined, topicModelOptions);
    this.agentRuntimeService = new AgentRuntimeService(db, userId, {
      ...options?.runtimeOptions,
      includeShareVisitor,
      agentFactory: createGraphAwareAgentFactory(options?.runtimeOptions?.agentFactory),
      // ── Runtime delegate ─────────────────────────────────────────────────
      // Operations the runtime delegates back UP to this layer. The dependency
      // arrow is one-way (AiAgentService → AgentRuntimeService), so the runtime
      // can't import us; instead we hand it the callbacks it needs to trigger
      // high-level pipelines mid-step. See AgentRuntimeDelegate. New high-level
      // capabilities the runtime calls into go in this `delegate` object.
      //
      // Arrow fields are auto-bound, so no `.bind(this)`.
      delegate: {
        execSubAgent: this.execSubAgent,
        execVirtualSubAgent: this.execVirtualSubAgent,
        execGroupMember: this.execGroupMember,
        verifyShareRunStillAuthorized: this.verifyShareRunStillAuthorized,
      },
      workspaceId: wsId,
    });

    // marketService is used for creds, sandbox, skills etc.
    // Read accessToken from DB; if options.marketAccessToken is provided, use it as override.
    if (options?.marketAccessToken) {
      this._marketService = new MarketService({
        accessToken: options.marketAccessToken,
        userInfo: { userId },
      });
    }
    this.composioService = new ComposioService({ db, userId, workspaceId: wsId });
    this.interventionController = new InterventionController({
      agentOperationModel: this.agentOperationModel,
      agentRuntimeService: this.agentRuntimeService,
      db: this.db,
      messageModel: this.messageModel,
      resolveDeviceWorkspaceId: (deviceId) => this.resolveDeviceWorkspaceId(deviceId),
      threadModel: this.threadModel,
      topicModel: this.topicModel,
      userId: this.userId,
    });
  }

  /** Shared dependency bundle for the thread-run helpers in `subAgentRuns.ts`. */
  private get subAgentRunDeps(): SubAgentRunDeps {
    return {
      agentOperationModel: this.agentOperationModel,
      agentRuntimeService: this.agentRuntimeService,
      execAgent: (p) => this.execAgent(p),
      messageModel: this.messageModel,
      threadModel: this.threadModel,
      userId: this.userId,
    };
  }

  /** Dependency bundle for one turn of `execAgent` (`pipeline/execTurn.ts`). */
  private get execAgentTurnDeps(): ExecAgentTurnDeps {
    return {
      agentDocumentsService: this.agentDocumentsService,
      agentModel: this.agentModel,
      agentOperationModel: this.agentOperationModel,
      agentRuntimeService: this.agentRuntimeService,
      composioService: this.composioService,
      connectorModel: this.connectorModel,
      connectorToolModel: this.connectorToolModel,
      db: this.db,
      getMarketService: (runFacts, options) => this.getMarketService(runFacts, options),
      messageModel: this.messageModel,
      pluginModel: this.pluginModel,
      resolveAgentConfigOrThrow: (id) => this.resolveAgentConfigOrThrow(id),
      resolveDeviceWorkspaceId: (deviceId) => this.resolveDeviceWorkspaceId(deviceId),
      resolveOperationTaskId: (id) => this.resolveOperationTaskId(id),
      resolveSourceAgentSnapshot: (agentId, sourceOperationId) =>
        this.resolveSourceAgentSnapshot(agentId, sourceOperationId),
      retirePendingApprovalOperation: (opId) => this.retirePendingApprovalOperation(opId),
      topicModel: this.topicModel,
      userId: this.userId,
      withholdGatewayToken: this.withholdGatewayToken,
      workspaceId: this.workspaceId,
    };
  }

  /** Dependency bundle for the topic-start stage in `pipeline/topicStart.ts`. */
  private get topicStartDeps(): TopicStartDeps {
    return {
      agentOperationModel: this.agentOperationModel,
      agentRuntimeService: this.agentRuntimeService,
      interruptTask: (p) => this.interruptTask(p),
      topicModel: this.topicModel,
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
  }

  private async getMarketService(
    runFacts?: RunFacts,
    options?: { sandboxStorage: SandboxStorageClaim },
  ): Promise<MarketService> {
    if (!options && this._marketService) return this._marketService;

    // The turn's fact reader already holds this row when a run is underway
    // (`execAgent` asks it for the memory / timezone settings too); callers
    // outside a run read it themselves.
    // Non-fatal either way — MarketService falls back to trustedClientToken.
    const settings = await (
      runFacts ? runFacts.userSettings() : new UserModel(this.db, this.userId).getUserSettings()
    ).catch(() => undefined);
    const accessToken = (settings?.market as any)?.accessToken;

    // A sandbox-workspace claim is signed into the trust token, so a service
    // carrying one is built for that run and kept out of the shared cache.
    if (options) {
      return new MarketService({
        accessToken,
        userInfo: {
          sandboxStorage: options.sandboxStorage,
          userId: this.userId,
          // The claim resolves against the workspace's mirrored organization,
          // not the member's personal account, so the scope has to travel with it.
          workspaceId: this.workspaceId,
        },
      });
    }

    this._marketService = new MarketService({
      accessToken,
      userInfo: { userId: this.userId },
    });
    return this._marketService;
  }

  private async resolveOperationTaskId(
    idOrIdentifier?: string | null,
  ): Promise<string | undefined> {
    if (!idOrIdentifier) return;

    // Task detail routes use human-readable identifiers such as `T-1`, while
    // operation runtimes store this value in FK-backed records.
    const task = await this.taskModel.resolve(idOrIdentifier);
    return task?.id;
  }

  /**
   * If `deviceId` is a device enrolled into the caller's current workspace,
   * return that workspaceId so device-gateway calls route to the
   * `workspace:<id>` principal. Returns undefined for a personal device (or no
   * workspace context), keeping the personal path byte-identical.
   */
  private async resolveDeviceWorkspaceId(
    deviceId: string | undefined,
  ): Promise<string | undefined> {
    if (!deviceId || !this.workspaceId) return undefined;
    const row = await new DeviceModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findWorkspaceDeviceById(deviceId);
    return row ? this.workspaceId : undefined;
  }

  /**
   * Execute a single agent step against this service's runtime.
   *
   * Delegates to the internal AgentRuntimeService, which is already wired with
   * the agent-invocation fork callbacks. The QStash step worker drives stepping
   * through here so `lobe-agent.callSubAgent` can fork virtual sub-agents —
   * building a bare runtime there would lose the callback and fail with
   * SUB_AGENT_UNAVAILABLE.
   */
  executeStep(params: AgentExecutionParams): Promise<AgentExecutionResult> {
    return this.agentRuntimeService.executeStep(params);
  }

  /** Continue a run parked in `waiting_for_client` (see AgentRuntimeService). */
  resumeFromClientLlmWait(
    params: Parameters<AgentRuntimeService['resumeFromClientLlmWait']>[0],
  ): ReturnType<AgentRuntimeService['resumeFromClientLlmWait']> {
    return this.agentRuntimeService.resumeFromClientLlmWait(params);
  }

  /** Runs of this user parked in `waiting_for_client`. */
  listClientLlmWaits(providers?: string[]): ReturnType<AgentRuntimeService['listClientLlmWaits']> {
    return this.agentRuntimeService.listClientLlmWaits(providers);
  }

  /** Mint a lock owner that spans a whole inline step loop. */
  createOperationLockOwner(operationId: string): string {
    return this.agentRuntimeService.createOperationLockOwner(operationId);
  }

  /** Publish a step that an inline loop deferred instead of running. */
  scheduleContinuation(continuation: AgentStepContinuation): Promise<void> {
    return this.agentRuntimeService.scheduleContinuation(continuation);
  }

  /** Release a lock retained across an inline step loop. */
  releaseOperationLock(operationId: string, stepLockOwner: string): Promise<void> {
    return this.agentRuntimeService.releaseOperationLock(operationId, stepLockOwner);
  }

  /**
   * Run the sub-agent completion bridge against this service's runtime.
   *
   * Same rationale as `executeStep`: the QStash `subagent-callback` webhook
   * drives the bridge through here so the runtime's models stay
   * workspace-scoped — a bare AgentRuntimeService would be personal-scoped
   * and the tool-message backfill / resume barrier could miss
   * workspace-scoped rows.
   */
  completeSubAgentBridge(params: SubAgentBridgeParams): Promise<boolean> {
    return this.agentRuntimeService.completeSubAgentBridge(params);
  }

  /**
   * Group-action member completion bridge entry point — driven by the QStash
   * `group-member-callback` webhook (queue mode). Forwards to the workspace-scoped
   * runtime so the member-anchor backfill + K=N barrier + resume/finish read the
   * same workspace rows. See `AgentRuntimeService.completeGroupActionMember`.
   */
  completeGroupActionMember(params: GroupActionMemberBridgeParams): Promise<boolean> {
    return this.agentRuntimeService.completeGroupActionMember(params);
  }

  /**
   * Resolve an agent by id or slug, with default config merged.
   *
   * Builtin agents (inbox / page / task / self-iteration slugs) may be addressed
   * purely by slug before a row exists — e.g. background self-iteration runs
   * dispatched via `execAgent({ slug })`. Lazily materialize the virtual row from
   * the builtin registry (mirrors the inbox/task `getBuiltinAgent` path) and
   * re-resolve. No-op for ordinary agent ids (getBuiltinAgent returns null).
   */
  private async resolveAgentConfigOrThrow(identifier: string) {
    let agentConfig = await this.agentService.getAgentConfig(identifier);
    if (!agentConfig && (Object.values(BUILTIN_AGENT_SLUGS) as string[]).includes(identifier)) {
      await this.agentModel.getBuiltinAgent(identifier);
      agentConfig = await this.agentService.getAgentConfig(identifier);
    }
    if (!agentConfig) {
      // `agentService.getAgentConfig` already routes through `AgentModel`'s
      // workspace + visibility ownership predicate, so a cross-user private
      // agent resolves to null here. Surface that as NOT_FOUND (not a generic
      // 500) so callers — chat, bot, cron task, sub-agent, REST — return a
      // uniform 404 and we never leak whether the id exists for another user.
      throw new TRPCError({ code: 'NOT_FOUND', message: `Agent not found: ${identifier}` });
    }

    return agentConfig;
  }

  /** Deps shared by every pre-created topic, so its snapshot matches `setupTurn`'s. */
  private precreatedTopicDeps(): PrecreatedTopicDeps {
    return {
      db: this.db,
      resolveAgentConfigOrThrow: (id) => this.resolveAgentConfigOrThrow(id),
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
  }

  /** Defer an agent run to a future time. See `pipeline/scheduleAgentRun`. */
  scheduleAgentRun(params: ScheduleAgentRunParams): Promise<ScheduleAgentRunResult> {
    return scheduleAgentRun(
      {
        ...this.precreatedTopicDeps(),
        messageModel: this.messageModel,
        topicModel: this.topicModel,
      },
      params,
    );
  }

  /**
   * Execute agent with just a prompt
   *
   * This is a simplified API that requires agent identifier (id or slug) and prompt.
   * All necessary data (agent config, tools, messages) will be fetched from the database.
   *
   * Architecture:
   * execAgent({ agentId | slug, prompt })
   *   → AgentModel.getAgentConfig(idOrSlug)
   *   → ServerMechaModule.AgentToolsEngine(config)
   *   → ServerMechaModule.ContextEngineering(input, config, messages)
   *   → AgentRuntimeService.createOperation(...)
   */
  async execAgent(inputParams: InternalExecAgentParams): Promise<ExecAgentResult> {
    // An approval on a group member's tool continues that member, not the
    // conversation's supervisor (see `resolveGroupMemberApprovalContinuation`).
    const memberContinuation = await resolveGroupMemberApprovalContinuation(
      createGroupMemberApprovalDeps({
        agentRuntimeService: this.agentRuntimeService,
        messageModel: this.messageModel,
        threadModel: this.threadModel,
      }),
      inputParams,
    );
    if (memberContinuation) {
      log(
        'execAgent: approval targets group member %s, continuing it under supervisor op %s',
        memberContinuation.agentId,
        memberContinuation.parentOperationId,
      );
      const continuation = await this.execAgent(memberContinuation);
      await rearmGroupMemberDeadline(
        { agentRuntimeService: this.agentRuntimeService },
        memberContinuation,
        continuation,
      );
      return {
        ...continuation,
        groupMemberContinuation: true,
        supervisorOperationId: memberContinuation.parentOperationId,
      };
    }

    // Creating the thread here (rather than inside the turn) means a run that
    // asked for one is already a thread run by the time the reservation check
    // below reads `appContext.threadId` — same isolation as a follow-up inside
    // an existing thread.
    const { createdThreadId, params } = await resolveNewThread(
      { threadModel: this.threadModel },
      inputParams,
    );
    // The client needs the id back to pivot its optimistic `_new` thread bucket
    // and refresh the sidebar; every return path below must carry it.
    const withCreatedThread = (result: ExecAgentResult): ExecAgentResult =>
      createdThreadId ? { ...result, createdThreadId } : result;

    return withCreatedThread(
      await runWithTopicStart(this.topicStartDeps, params, (p) =>
        this.execAgentWithApprovalRollback(p),
      ),
    );
  }

  /**
   * A human decision is claimed before the rest of operation preparation reads
   * message history. Keep its rollback guard outside the large preparation
   * routine so every throw and every early return before createOperation starts
   * restores the exact pending rows, not only queue-start failures.
   */
  private async execAgentWithApprovalRollback(
    params: InternalExecAgentParams,
  ): Promise<ExecAgentResult> {
    const approvalClaim: ApprovalClaimState = {
      continuationPrepared: false,
      continuationStarted: false,
      rollbackSnapshot: [],
    };

    try {
      return await execAgentTurn(this.execAgentTurnDeps, params, approvalClaim);
    } finally {
      if (
        !approvalClaim.continuationPrepared &&
        !approvalClaim.continuationStarted &&
        approvalClaim.rollbackSnapshot.length > 0
      ) {
        await this.messageModel.restoreHumanApproval(approvalClaim.rollbackSnapshot);
        log(
          'execAgent: restored %d approval rows before continuation startup',
          approvalClaim.rollbackSnapshot.length,
        );
      }
    }
  }

  /**
   * Execute Group Agent (Supervisor) in a single call
   *
   * This method handles Group-specific logic (topic with groupId) and delegates
   * the core agent execution to execAgent.
   *
   * Flow:
   * 1. Create topic with groupId (if needed)
   * 2. Delegate to execAgent for the rest
   */
  async execGroupAgent(params: ExecGroupAgentParams): Promise<ExecGroupAgentResult> {
    const { agentId, groupId, message, topicId: inputTopicId, newTopic } = params;

    log(
      'execGroupAgent: agentId=%s, groupId=%s, message=%s',
      agentId,
      groupId,
      message.slice(0, 50),
    );

    // 1. Create topic with groupId if needed
    let topicId = inputTopicId;
    let isCreateNewTopic = false;

    // Create new topic when:
    // - newTopic is explicitly provided, OR
    // - no topicId is provided (default behavior for group chat)
    if (newTopic || !inputTopicId) {
      topicId = await createGroupAgentTopic(
        { ...this.precreatedTopicDeps(), topicModel: this.topicModel },
        { agentId, groupId, message, newTopic },
      );
      isCreateNewTopic = true;
      log('execGroupAgent: created new topic %s with groupId %s', topicId, groupId);
    }

    // 2. Delegate to execAgent with groupId in appContext.
    // execGroupAgent always runs the group's supervisor, so stamp the
    // orchestration role onto the run — it lands on the assistant message
    // metadata and drives supervisor-flavored UI rendering.
    const result = await this.execAgent({
      agentId,
      appContext: { groupId, orchestrationRole: 'supervisor', topicId },
      autoStart: true,
      prompt: message,
      trigger: RequestTrigger.Chat,
    });

    log(
      'execGroupAgent: delegated to execAgent, operationId=%s, success=%s',
      result.operationId,
      result.success,
    );

    return {
      assistantMessageId: result.assistantMessageId,
      error: result.error,
      isCreateNewTopic,
      operationId: result.operationId,
      success: result.success,
      topicId: result.topicId,
      userMessageId: result.userMessageId,
    };
  }

  /**
   * Snapshot the agent that launched an agent → agent run (`metadata.agentSender`)
   * from the caller's own operation row; `resolveAgentSenderFromOperation` owns the
   * trust and shareability rules.
   */
  private resolveSourceAgentSnapshot = (
    destinationAgentId: string,
    sourceOperationId?: string,
  ): Promise<AgentSenderMetadata | undefined> =>
    resolveAgentSenderFromOperation(sourceOperationId, {
      destinationAgentId,
      findAgentDisplayFields: (agentId) => this.agentModel.getAgentDisplayFields(agentId),
      findAgentVisibility: (agentId) => this.agentModel.getAgentVisibility(agentId),
      findChatGroupVisibility: async (chatGroupId) =>
        (await new ChatGroupModel(this.db, this.userId, this.workspaceId).findById(chatGroupId))
          ?.visibility ?? null,
      findOperation: (operationId) => this.agentOperationModel.findById(operationId),
      findTopic: (topicId) => this.topicModel.findById(topicId),
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

  /**
   * `AgentRuntimeDelegate.verifyShareRunStillAuthorized` implementation — see
   * `AgentShareModel.isRunStillAuthorized`'s JSDoc for what "authorized" means
   * and why a per-step recheck (not only at step 0) is what actually stops a
   * revoked share's run: nothing tears down an operation that already exists,
   * and the visitor's own Stop button breaks the instant the share goes
   * private, so the step loop has to re-prove authorization itself.
   *
   * A plain top-level `db` read (not scoped to `this.userId`/workspace):
   * `agent_shares` has no ownership predicate applicable here — this call runs
   * from inside the CREATOR's own runtime step, so `this.db` is already the
   * correct connection.
   *
   * Arrow field (not a method) so it stays bound when handed to
   * AgentRuntimeService.
   */
  verifyShareRunStillAuthorized = async (params: {
    agentId: string;
    shareId: string;
  }): Promise<boolean> => AgentShareModel.isRunStillAuthorized(this.db, params);

  /**
   * Execute an agent in an isolated Thread context.
   *
   * Group/callAgent paths use this entry. It does not mark the child as a
   * virtual sub-agent and it does not install the async completion bridge.
   */
  // Arrow field (not a method) so it stays bound when handed to AgentRuntimeService.
  execSubAgent = async (
    params: ExecSubAgentParams,
    options: {
      /** The dispatching tab stands by on this channel to run the child's device-only LLM calls. */
      llmRelay?: SubAgentLlmRelayRequest;
    } = {},
  ): Promise<ExecSubAgentResult> => {
    const llmExecutor = await openSubAgentLlmRelay(options.llmRelay, {
      streamManager: createStreamEventManager(),
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    return execAgentThreadRun(this.subAgentRunDeps, params, {
      isSubAgent: false,
      llmExecutor,
      logScope: 'execSubAgent',
    });
  };

  /** The tab stopped standing by on a sub-agent's relay channel: end it on the gateway. */
  releaseSubAgentLlmRelay = async (channel: string): Promise<{ success: boolean }> => ({
    success: await closeSubAgentLlmRelay(channel, this.userId, createStreamEventManager()),
  });

  /**
   * Execute a virtual sub-agent created by `lobe-agent.callSubAgent`.
   *
   * This path is a child operation of the current agent run. It is marked as a
   * sub-agent so it cannot recursively spawn more sub-agents, and it registers
   * the bridge that backfills the parent's placeholder tool message.
   */
  execVirtualSubAgent = async (params: ExecVirtualSubAgentParams): Promise<ExecSubAgentResult> =>
    execAgentThreadRun(this.subAgentRunDeps, params, {
      chatConfig: params.chatConfig,
      deviceId: params.deviceId,
      isSubAgent: true,
      localDeviceId: params.localDeviceId,
      logScope: 'execVirtualSubAgent',
      // Sub-agent model is resolved at the spawn site (callSubAgent runner) from
      // the parent agent's `agencyConfig.subagent` and threaded through here as an
      // explicit override, so execAgent never re-reads the parent config.
      model: params.model,
      provider: params.provider,
      resumeParentOnComplete: true,
    });

  /**
   * Fork a single group member ("call agent member") under a `lobe-group-management`
   * tool call. Dispatches to the in-group (non-isolated, shared group session)
   * or isolated (own thread) path, installing the group-action member completion
   * bridge. Invoked once per member by the runtime's `agentMember` runner.
   *
   * Arrow field (not a method) so it stays bound when handed to the runtime
   * delegate.
   */
  execGroupMember = async (params: ExecGroupMemberParams): Promise<ExecGroupMemberResult> => {
    if (params.mode === 'isolated') {
      return execIsolatedAgentMember(this.subAgentRunDeps, params);
    }

    return execAgentMember(this.subAgentRunDeps, params);
  };

  /**
   * Interrupts a running task and coordinates any device-hosted process shutdown.
   * Delegates to {@link InterventionController}.
   */
  async interruptTask(params: {
    operationId?: string;
    threadId?: string;
    topicId?: string;
  }): Promise<{
    deviceCancellationConfirmed?: boolean;
    operationId?: string;
    success: boolean;
    threadId?: string;
  }> {
    return this.interventionController.interruptTask(params);
  }

  /**
   * Flags whether the composer still holds user messages queued behind a run.
   * Delegates to {@link InterventionController}.
   */
  async setQueuedMessages(params: {
    operationId: string;
    pending: boolean;
  }): Promise<{ success: boolean }> {
    return this.interventionController.setQueuedMessages(params);
  }

  /** Settle a parked approval batch and terminate its operation. */
  stopPendingApproval(params: {
    approvalResolutionRequestId?: string;
    batchId: string;
    operationId: string;
    toolMessageIds: string[];
    topicId: string;
  }): Promise<{ operationId: string; settledToolMessageIds: string[]; success: boolean }> {
    return this.interventionController.stopPendingApproval(params);
  }

  /** Retire the operation segment parked on an approval. */
  retirePendingApprovalOperation(operationId: string): Promise<void> {
    return this.interventionController.retirePendingApprovalOperation(operationId);
  }

  /** Owner-scoped runtime state used by the v2 router's crash-safe retry probe. */
  loadInterventionContinuationState(operationId: string): Promise<AgentState | null> {
    return this.interventionController.loadInterventionContinuationState(operationId);
  }

  /** Requeue an idle deterministic continuation without rebuilding its assistant turn. */
  ensureInterventionContinuationStarted(
    operationId: string,
  ): Promise<'already_started' | 'missing' | 'scheduled'> {
    return this.interventionController.ensureInterventionContinuationStarted(operationId);
  }

  /**
   * Repair the topic reconnect marker and release the exact start reservation
   * after a durable queue ACK. Delegates to {@link InterventionController}.
   */
  repairInterventionContinuationTopicAnchor(params: {
    assistantMessageId: string;
    continuationOperationId: string;
    resolutionRequestId: string;
    scope?: string | null;
    sourceOperationId: string;
    sourceToolMessageIds: string[];
    threadId?: string | null;
    topicId: string;
  }): Promise<void> {
    return this.interventionController.repairInterventionContinuationTopicAnchor(params);
  }
}
