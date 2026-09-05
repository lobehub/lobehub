import type { AgentState } from '@lobechat/agent-runtime';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  ExecAgentResult,
  ExecGroupAgentParams,
  ExecGroupAgentResult,
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
  ScheduleAgentRunParams,
  ScheduleAgentRunResult,
  UserInterventionConfig,
  WorkingDirConfig,
} from '@lobechat/types';
import { getWorkingDirEffectivePath, RequestTrigger } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import {
  deriveAgentInterventionContinuationMessageId,
  deriveAgentInterventionContinuationOperationId,
} from '@/business/server/agent-run/agentInterventionIdentity';
import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { AgentShareModel } from '@/database/models/agentShare';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { DeviceModel } from '@/database/models/device';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TaskModel } from '@/database/models/task';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { AgentService } from '@/server/services/agent';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import type {
  AgentExecutionParams,
  AgentExecutionResult,
  AgentRuntimeServiceOptions,
  SubAgentBridgeParams,
} from '@/server/services/agentRuntime';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { getAbortError, throwIfAborted } from '@/server/services/agentRuntime/abort';
import type {
  ExecGroupMemberParams,
  ExecGroupMemberResult,
  GroupActionMemberBridgeParams,
} from '@/server/services/agentRuntime/types';
import { ComposioService } from '@/server/services/composio';
import { MarketService } from '@/server/services/market';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { createGraphAwareAgentFactory } from './helpers/agentFactory';
import { createGroupActionMemberBridgeHook } from './hooks/threadRunHooks';
import { InterventionController } from './intervention/InterventionController';
import type { ApprovalClaimState } from './pipeline/approvalResume';
import {
  buildApprovalResumeContext,
  claimApprovalResume,
  tryReuseInterventionContinuation,
} from './pipeline/approvalResume';
import { dispatchHeteroAgent } from './pipeline/heteroDispatch';
import { createHistoryMessagesLoader, prepareOperation } from './pipeline/operationPrep';
import { resolveRunAgentConfig } from './pipeline/resolveRunAgentConfig';
import { startOperation } from './pipeline/startOperation';
import { discoverTools } from './pipeline/toolDiscovery';
import { setupTurn } from './pipeline/turnSetup';
import { applyShareGateToAgentConfig } from './shareGate';
import type { SubAgentRunDeps } from './subAgentRuns';
import { execAgentMember, execAgentThreadRun } from './subAgentRuns';
import { acquireTopicStartReservation } from './topicStartReservation';
import type { ExecRunContext, InternalExecAgentParams } from './types';

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

  private async getMarketService(): Promise<MarketService> {
    if (this._marketService) return this._marketService;

    let accessToken: string | undefined;
    try {
      const userModel = new UserModel(this.db, this.userId);
      const settings = await userModel.getUserSettings();
      accessToken = (settings?.market as any)?.accessToken;
    } catch {
      // non-fatal — MarketService will fall back to trustedClientToken
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
   * Pin a topic to the directory its run actually executes in.
   *
   * A topic created by a device-bound run starts with no cwd of its own: the
   * directory was only ever recorded at agent level
   * (`agencyConfig.workingDirByDevice`) or on the device (`defaultCwd`). Without
   * this write the topic stays unbound — By-Project grouping files it under "No
   * directory", and every later turn re-resolves from the agent config, so
   * changing the agent's directory silently moves an old conversation to a new
   * project (and makes hetero `--resume` unsafe).
   *
   * Shared by BOTH execution paths — hetero device dispatch and the normal
   * agent runtime — so a native agent bound to a device gets the same binding a
   * CLI agent does. Purely additive: a topic that already carries a cwd (the
   * client resolved one and sent it as `initialTopicMetadata`, or an earlier
   * turn bound it) is never rewritten, so the historical pin always wins.
   */
  private async bindTopicWorkingDirectory(params: {
    config?: WorkingDirConfig;
    currentWorkingDirectory?: string;
    topicId: string;
  }): Promise<void> {
    const { config, currentWorkingDirectory, topicId } = params;
    if (currentWorkingDirectory || !config) return;
    const path = getWorkingDirEffectivePath(config);
    if (!path) return;

    try {
      await this.topicModel.updateMetadata(topicId, {
        workingDirectory: path,
        workingDirectoryConfig: config,
      });
    } catch (err) {
      // Metadata bookkeeping must never fail a run that is otherwise fine.
      log('execAgent: bindTopicWorkingDirectory failed (non-fatal): %O', err);
    }
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

  /**
   * Defer an agent run to a future time ("send this in 3 hours").
   *
   * Creates the topic now, `scheduled` and empty, carrying the whole request in
   * `metadata.scheduledRun`; the cron dispatcher replays it through `execAgent`
   * once `runAt` passes. The prompt is deliberately NOT pre-persisted as a user
   * message — storing the request whole keeps the dispatch identical to a user
   * pressing send, and keeps editing / cancelling a pending run a single JSONB
   * write.
   *
   * One-shot only: recurring execution belongs to `tasks.automationMode = 'schedule'`.
   */
  async scheduleAgentRun(params: ScheduleAgentRunParams): Promise<ScheduleAgentRunResult> {
    const { agentId, slug, prompt, runAt, fileIds, groupId, model, provider } = params;

    if (!agentId && !slug) throw new Error('Either agentId or slug must be provided');

    const runAtDate = new Date(runAt);
    if (Number.isNaN(runAtDate.getTime())) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid runAt: ${runAt}` });
    }
    if (runAtDate.getTime() <= Date.now()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'runAt must be in the future' });
    }

    const agentConfig = await this.resolveAgentConfigOrThrow(agentId || slug!);
    const resolvedAgentId = agentConfig.id;

    const titleSource = markdownToTxt(prompt);
    const topic = await this.topicModel.create({
      agentId: resolvedAgentId,
      groupId,
      // A scheduled run is still an ordinary user chat, just deferred — so it
      // keeps the `chat` trigger and stays in the main sidebar (where its
      // `scheduled` status renders a clock), unlike system-owned cron topics.
      title: titleSource.slice(0, 50) + (titleSource.length > 50 ? '...' : ''),
      trigger: 'chat',
    });

    // Persist the user turn now rather than stashing the prompt in metadata: the
    // pending run then reads as the user's own words in the topic, and the message
    // stays the single source of truth for the prompt (the dispatcher reads it
    // back, so editing a pending run is just editing the message).
    const userMessage = await this.messageModel.create({
      agentId: resolvedAgentId,
      content: prompt,
      files: fileIds,
      groupId: groupId ?? undefined,
      metadata: { trigger: RequestTrigger.Scheduled },
      role: 'user',
      topicId: topic.id,
    });

    const now = new Date().toISOString();
    await this.topicModel.armScheduledRun(topic.id, {
      createdAt: now,
      kind: 'delayed_start',
      model,
      provider,
      // Normalize to UTC ISO: the dispatcher's due query compares this as text.
      runAt: runAtDate.toISOString(),
      updatedAt: now,
      userMessageId: userMessage.id,
    });

    log(
      'scheduleAgentRun: topic %s scheduled for %s (agent %s, message %s)',
      topic.id,
      runAtDate.toISOString(),
      resolvedAgentId,
      userMessage.id,
    );

    return { agentId: resolvedAgentId, runAt: runAtDate.toISOString(), topicId: topic.id };
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
    // Creating the thread here (rather than inside the turn) means a run that
    // asked for one is already a thread run by the time the reservation check
    // below reads `appContext.threadId` — same isolation as a follow-up inside
    // an existing thread.
    const { createdThreadId, params } = await this.resolveNewThread(inputParams);
    // The client needs the id back to pivot its optimistic `_new` thread bucket
    // and refresh the sidebar; every return path below must carry it.
    const withCreatedThread = (result: ExecAgentResult): ExecAgentResult =>
      createdThreadId ? { ...result, createdThreadId } : result;

    const topicId = params.appContext?.topicId;
    const interventionReservationId = params.approvalResolutionRequestId
      ? deriveAgentInterventionContinuationOperationId({
          resolutionRequestId: params.approvalResolutionRequestId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        })
      : undefined;
    if (
      interventionReservationId &&
      params.topicStartReservationId &&
      params.topicStartReservationId !== interventionReservationId
    ) {
      throw new Error('Intervention continuation reservation identity conflict');
    }
    const reservationId =
      interventionReservationId ?? params.topicStartReservationId ?? `agent-start-${nanoid()}`;
    const isInterventionThreadStart = Boolean(
      topicId &&
      params.appContext?.threadId &&
      interventionReservationId &&
      params.approvalResolutionRequestId,
    );
    // Thread runs are isolated under an explicit parent message and do not
    // advance the topic's main spine. They may start while their parent
    // operation owns `runningOperation` (for example callAgent/callSubAgent),
    // so making them wait for the topic-start claim deadlocks the child start.
    if (!topicId || (params.appContext?.threadId && !isInterventionThreadStart)) {
      return withCreatedThread(await this.execAgentWithApprovalRollback(params));
    }

    // A replacement is allowed to take over the topic marker, but the device
    // process that owned the old marker may still hold a native Codex/CC writer.
    // Settle that physical run before reserving and dispatching the replacement;
    // otherwise two `lh hetero exec` wrappers can resume the same thread.
    if (params.replacesOperationId && !isInterventionThreadStart) {
      const interruption = await this.interruptTask({
        operationId: params.replacesOperationId,
        topicId,
      });
      if (interruption.deviceCancellationConfirmed === false) {
        throw new Error('Replaced heterogeneous agent process did not confirm termination');
      }
    }
    const reserved = await acquireTopicStartReservation({
      allowSameReservationReentry: !params.approvalResolutionRequestId,
      replacesOperationId: isInterventionThreadStart ? undefined : params.replacesOperationId,
      allowRunningOperationId: params.topicStartOwnerOperationId,
      // A thread continuation shares the topic row but never owns/replaces its
      // main runningOperation anchor. It uses only the short initializer fence.
      ignoreRunningOperation: isInterventionThreadStart || params.interactiveStart,
      reservationId,
      topicId,
      topicModel: this.topicModel,
    });

    if (!reserved) {
      throw new Error(`Topic not found: ${topicId}`);
    }

    try {
      return withCreatedThread(await this.execAgentWithApprovalRollback(params));
    } finally {
      await this.topicModel.releaseTaskCallbackReservation(topicId, reservationId);
    }
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
      return await this.execAgentWithReservation(params, approvalClaim);
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
   * Materialise an `appContext.newThread` intent into a real thread row.
   *
   * The composer stages a subtopic client-side and the non-gateway send path
   * creates it inside `sendMessageInServer` (`newThread`). The gateway path
   * never makes that call, so the intent arrives here instead — without this
   * the turn would persist onto the topic's main spine, no thread row would
   * exist, and the subtopic would silently collapse back into the main
   * conversation.
   *
   * Returns the params to run with: `appContext.threadId` rebound to the new
   * thread so every downstream read (message writes, history queries, operation
   * context) lands inside it. A no-op for every caller that doesn't ask for one.
   */
  private async resolveNewThread(params: InternalExecAgentParams): Promise<{
    createdThreadId?: string;
    params: InternalExecAgentParams;
  }> {
    const { appContext } = params;
    const newThread = appContext?.newThread;

    // `threadId` wins: that is a follow-up inside a thread that already exists,
    // and creating a second row would orphan the earlier turns.
    if (!newThread || appContext?.threadId) return { params };

    // A subtopic branches off a persisted message, so its topic always exists by
    // the time the send reaches here. Refusing is better than silently creating
    // a thread on a topic this run is about to mint under a different id.
    if (!appContext?.topicId) {
      throw new Error('appContext.newThread requires an existing appContext.topicId');
    }

    const thread = await this.threadModel.create({
      parentThreadId: newThread.parentThreadId,
      sourceMessageId: newThread.sourceMessageId,
      title: newThread.title,
      topicId: appContext.topicId,
      type: newThread.type,
    });

    // `ThreadModel.create` swallows insert conflicts and returns undefined.
    // Falling through would persist the turn to the main spine — exactly the
    // failure this path exists to prevent — so fail loudly instead.
    if (!thread) {
      throw new Error(`Failed to create thread on topic ${appContext.topicId}`);
    }

    log('execAgent: created thread %s on topic %s', thread.id, appContext.topicId);

    return {
      createdThreadId: thread.id,
      params: {
        ...params,
        appContext: { ...appContext, threadId: thread.id },
        createdThreadId: thread.id,
      },
    };
  }

  private async execAgentWithReservation(
    params: InternalExecAgentParams,
    approvalClaim: ApprovalClaimState,
  ): Promise<ExecAgentResult> {
    const {
      additionalPluginIds,
      exclusivePluginIds,
      agentId,
      slug,
      prompt,
      appContext,
      autoStart = true,
      botContext,
      createdThreadId,
      clientIp,
      userAgent,
      deviceId: requestedDeviceId,
      localDeviceId,
      botPlatformContext,
      discordContext,
      existingMessageIds = [],
      fileIds: attachedFileIds,
      files,
      functionTools,
      hooks,
      instructions,
      chatConfigOverride,
      toolModeOverride,
      model: modelOverride,
      provider: providerOverride,
      stream,
      title,
      trigger,
      cronJobId,
      taskId,
      evalContext,
      evalRuntime,
      maxSteps,
      disableLocalSystem,
      initialStepCount,
      signal,
      userInterventionConfig: requestedUserInterventionConfig = { approvalMode: 'headless' },
      queueRetries,
      queueRetryDelay,
      parentMessageId,
      parentOperationId,
      resume,
      resumeApproval,
      resumeApprovals,
      resumeToolResult,
      approvalResolutionRequestId: providedApprovalResolutionRequestId,
      approvalSourceOperationId: providedApprovalSourceOperationId,
      selectedToolIds,
      shareGate,
      mentionedAgents,
      suppressUserMessage,
      ephemeralUserMessage,
    } = params;

    // Agent Share visitor runs execute under the CREATOR's credentials (see
    // `shareChat.ts` `execAgent` → `AiAgentService.execAgent({ shareGate })`)
    // with no visitor-facing approval UI at all, so no approval can ever be
    // WAITED for: `headless` is the only mode that converts an intervention
    // into an immediate blocked tool result ('always'-policy calls become
    // `resolve_blocked_tools`) instead of parking the run on
    // `request_human_approve` forever. Forced unconditionally — overriding
    // whatever the caller passed — so a future execAgent call site cannot
    // reintroduce a waiting mode by omission.
    //
    // `headless` DOES auto-run overridable ('required') interventions. That is
    // acceptable here only because of the two share-specific layers on top:
    // `applyShareGateToInterventionRequiredApis` strips every
    // intervention-gated API from what the model is offered, and
    // `isShareBlockedBuiltinDispatch` re-blocks intervention-gated (and
    // non-enabled, and data-rule-violating) builtin calls at the executor
    // dispatch site — re-reading the UNSTRIPPED manifest, since the assembly
    // strip removes the very intervention config the runtime would otherwise
    // consult. No 'required' builtin API can execute through either layer.
    const userInterventionConfig: UserInterventionConfig = shareGate
      ? { approvalMode: 'headless' }
      : requestedUserInterventionConfig;

    // Honour client-minted row ids on a FRESH send only. Resume / regeneration
    // replays reach this method too (resumeApproval, resumeToolResult,
    // parentMessageId), and a replayed id there would collide with the row the
    // original send already created — so those paths drop the ids defensively
    // rather than trusting every caller to omit them.
    const interventionResumeCount = [resumeApproval, resumeApprovals, resumeToolResult].filter(
      Boolean,
    ).length;
    if (interventionResumeCount > 1) {
      throw new Error(
        'Only one of resumeApproval, resumeApprovals, or resumeToolResult may be provided',
      );
    }

    const isResumeLike =
      !!resume ||
      !!resumeApproval ||
      !!resumeApprovals?.length ||
      !!resumeToolResult ||
      !!parentMessageId;
    const clientIds = isResumeLike ? undefined : params.clientIds;

    // Validate that either agentId or slug is provided
    if (!agentId && !slug) {
      throw new Error('Either agentId or slug must be provided');
    }

    // Determine the identifier to use (agentId takes precedence)
    const identifier = agentId || slug!;

    log('execAgent: identifier=%s, prompt=%s', identifier, prompt.slice(0, 50));

    const operationTaskId = await this.resolveOperationTaskId(taskId ?? appContext?.taskId);

    const assistantMessageRef: { current?: string } = {};
    const updateAbortedAssistantMessage = async (errorMessage: string) => {
      if (!assistantMessageRef.current) return;

      try {
        await this.messageModel.update(assistantMessageRef.current, {
          content: '',
          error: {
            body: {
              detail: errorMessage,
            },
            message: errorMessage,
            type: 'ServerAgentRuntimeError',
          },
        });
      } catch (error) {
        log(
          'execAgent: failed to update aborted assistant message %s: %O',
          assistantMessageRef.current,
          error,
        );
      }
    };
    const throwIfExecutionAborted = async (stage: string) => {
      if (!signal?.aborted) return;

      const error = getAbortError(signal, `Agent execution aborted during ${stage}`);
      await updateAbortedAssistantMessage(error.message);
      throw error;
    };

    throwIfAborted(signal, 'Agent execution aborted before startup');

    // Stages 1–2.5 — resolve the effective agent config for this run
    // (see `pipeline/resolveRunAgentConfig`).
    const {
      agentConfig,
      agentSlug,
      assistantAgentId,
      canManageAgent,
      conversationAgentId,
      disabledPluginIds,
      isPublicWorkspaceAgent,
      memberDeviceOverride,
      persistAgentId,
      resolvedAgentId,
    } = await resolveRunAgentConfig(
      {
        db: this.db,
        resolveAgentConfigOrThrow: (id) => this.resolveAgentConfigOrThrow(id),
        userId: this.userId,
        workspaceId: this.workspaceId,
      },
      {
        appContext,
        chatConfigOverride,
        identifier,
        instructions,
        modelOverride,
        providerOverride,
        throwIfExecutionAborted,
        toolModeOverride,
      },
    );

    // Share-visitor runs must never see the creator's files/knowledge bases.
    // Applied to the resolved config before anything downstream (knowledge
    // flags, tools engine, context snapshot) reads it.
    if (shareGate) applyShareGateToAgentConfig(agentConfig);

    let resumeParentMessage: Awaited<ReturnType<MessageModel['findById']>>;

    // `resumeApproval` implies the same "load parent message + skip user
    // message creation" semantics as `resume`. Callers that go through the
    // tRPC router get `resume: true` via the router, but the service-level
    // API allows resumeApproval alone — fold both into a single effective
    // flag so downstream resume branches don't need to know about approval.
    // Normalize the single and batch approval forms into one list so every
    // branch below (validation, DB writes, resume context) has a single shape
    // to reason about. `resumeApproval` stays the wire format for one decision.
    const approvalDecisions = resumeApprovals?.length
      ? resumeApprovals
      : resumeApproval
        ? [resumeApproval]
        : [];

    const effectiveResume = resume || approvalDecisions.length > 0 || !!resumeToolResult;

    // Both resume and suppressUserMessage run the turn off existing history
    // instead of appending a new user message — share the message-construction
    // branches below. Resume-specific validation/approval stays gated on
    // `effectiveResume` only.
    const runFromHistory = effectiveResume || !!suppressUserMessage;

    if (effectiveResume) {
      if (!parentMessageId) {
        throw new Error('parentMessageId is required when resume is true');
      }

      if (!appContext) {
        throw new Error('appContext is required when resume is true');
      }

      if (!appContext.topicId) {
        throw new Error('appContext.topicId is required when resume is true');
      }

      resumeParentMessage = await this.messageModel.findById(parentMessageId);

      if (!resumeParentMessage) {
        throw new Error(`Parent message not found: ${parentMessageId}`);
      }

      if (resumeParentMessage.topicId !== appContext.topicId) {
        throw new Error('appContext.topicId does not match parent message');
      }

      if (
        resumeParentMessage.threadId &&
        resumeParentMessage.threadId !== (appContext.threadId ?? undefined)
      ) {
        throw new Error('appContext.threadId does not match parent message');
      }

      if (resumeParentMessage.sessionId && resumeParentMessage.sessionId !== appContext.sessionId) {
        throw new Error('appContext.sessionId does not match parent message');
      }
    }

    // Stages 2.6–2.7 — claim the human decision(s) before anything below reads
    // message history (see `pipeline/approvalResume`).
    const {
      approvalOwnerAssistantId,
      approvalSourceOperationId,
      approvalSourceToolMessageIds,
      approvedToolEntries,
      batchApprovalAnchorId,
      resumeApprovalPlugin,
    } = await claimApprovalResume(
      { messageModel: this.messageModel },
      {
        appContext,
        approvalClaim,
        approvalDecisions,
        parentMessageId,
        providedApprovalResolutionRequestId,
        providedApprovalSourceOperationId,
        resumeApprovals,
        resumeParentMessage,
        resumeToolResult,
      },
    );

    // Deterministic continuation identity for a generic (v2) approval claim.
    // Also consumed by the turn setup below: a crash-safe re-entry must find
    // the SAME assistant placeholder instead of minting a second turn.
    const continuationIdentity = providedApprovalResolutionRequestId
      ? {
          resolutionRequestId: providedApprovalResolutionRequestId,
          userId: this.userId,
          workspaceId: this.workspaceId,
        }
      : undefined;
    const continuationOperationId = continuationIdentity
      ? deriveAgentInterventionContinuationOperationId(continuationIdentity)
      : undefined;
    const continuationAssistantId = continuationIdentity
      ? deriveAgentInterventionContinuationMessageId(continuationIdentity)
      : undefined;

    const reusedContinuation = await tryReuseInterventionContinuation(
      {
        agentOperationModel: this.agentOperationModel,
        agentRuntimeService: this.agentRuntimeService,
        messageModel: this.messageModel,
        userId: this.userId,
        withholdGatewayToken: this.withholdGatewayToken,
        workspaceId: this.workspaceId,
      },
      {
        approvalClaim,
        approvalSourceOperationId,
        approvalSourceToolMessageIds,
        continuationAssistantId,
        continuationOperationId,
        parentMessageId,
        providedApprovalResolutionRequestId,
        resolvedAgentId,
        topicId: appContext?.topicId,
      },
    );
    if (reusedContinuation) return reusedContinuation;

    // Stage 3 + shared turn setup — topic creation/reuse (with the pinned
    // model), device-access policy, hetero detection, attachment ingestion, and
    // the persisted user/assistant rows (see `pipeline/turnSetup`).
    const turn = await setupTurn(
      {
        db: this.db,
        messageModel: this.messageModel,
        topicModel: this.topicModel,
        userId: this.userId,
        workspaceId: this.workspaceId,
      },
      {
        agentConfig,
        agentSlug,
        appContext,
        assistantAgentId,
        attachedFileIds,
        batchApprovalAnchorId,
        botContext,
        clientIds,
        continuationAssistantId,
        conversationAgentId,
        createdThreadId,
        cronJobId,
        files,
        modelOverride,
        operationTaskId,
        parentMessageId,
        prompt,
        providerOverride,
        requestedDeviceId,
        resolvedAgentId,
        resume,
        runFromHistory,
        shareGate,
        throwIfExecutionAborted,
        title,
        trigger,
      },
    );
    assistantMessageRef.current = turn.assistantMessageId;
    const {
      canUseDevice,
      deviceAccessReason,
      isHeteroAgent,
      model,
      provider,
      requestTriggerMetadata,
      runAttachments,
      selfMessageIds,
      topicId,
    } = turn;

    // Shared context for the extracted execAgent pipeline stages
    // (`pipeline/*`). Built after the turn rows exist so every stage sees the
    // persisted anchors; `agentConfig` stays the same mutable object so stage
    // systemRole appends remain visible to `createOperation` below.
    const runContext: ExecRunContext = {
      agentConfig,
      appContext,
      assistantMessageId: turn.assistantMessageId,
      canUseDevice,
      deviceAccessReason,
      model,
      parentMessageId,
      persistAgentId,
      prompt,
      provider,
      resolvedAgentId,
      shareGate,
      topicId,
      trigger,
      userMessageId: turn.userMessageId,
    };

    if (isHeteroAgent) {
      return dispatchHeteroAgent(
        {
          bindTopicWorkingDirectory: (p) => this.bindTopicWorkingDirectory(p),
          db: this.db,
          getMarketService: () => this.getMarketService(),
          messageModel: this.messageModel,
          resolveDeviceWorkspaceId: (deviceId) => this.resolveDeviceWorkspaceId(deviceId),
          topicModel: this.topicModel,
          userId: this.userId,
          withholdGatewayToken: this.withholdGatewayToken,
          workspaceId: this.workspaceId,
        },
        runContext,
        {
          canManageAgent,
          effectiveRequestedDeviceId: turn.effectiveRequestedDeviceId,
          heteroType: turn.heteroType,
          heterogeneousProvider: turn.heterogeneousProvider,
          hooks,
          isPublicWorkspaceAgent,
          localDeviceId,
          maxSteps,
          memberDeviceOverride,
          operationTaskId,
          parentOperationId,
          pinnedHeterogeneousTopicModel: turn.pinnedHeterogeneousTopicModel,
          requestTrigger: requestTriggerMetadata.trigger,
          requestedDeviceId,
          runAttachments,
          selfMessageIds,
          topicStartOwnerOperationId: params.topicStartOwnerOperationId,
        },
      );
    }

    // 4. Fetch user settings (memory config + timezone)
    // Agent-level memory config takes priority; fallback to user-level setting
    const agentMemoryEnabled = agentConfig.chatConfig?.memory?.enabled;
    let globalMemoryEnabled = agentMemoryEnabled ?? false;
    let enableExpertise = false;
    let userTimezone: string | undefined;
    try {
      const userModel = new UserModel(this.db, this.userId);
      const settings = await userModel.getUserSettings();
      const memorySettings = settings?.memory as { enabled?: boolean } | undefined;

      globalMemoryEnabled = agentMemoryEnabled ?? memorySettings?.enabled !== false;

      // Timezone drives the session-date placeholder rendered back to whoever
      // is actually conversing. In a share-visitor run that is the VISITOR,
      // not the creator whose settings this block otherwise reads — memory /
      // expertise intentionally stay creator-scoped below (gated by
      // `allowReadMemory`), but the timezone has no such gate and must not
      // leak the creator's own setting into a visitor's turn.
      if (shareGate) {
        const visitorSettings = await new UserModel(
          this.db,
          shareGate.visitorUserId,
        ).getUserSettings();
        const visitorGeneralSettings = visitorSettings?.general as
          { timezone?: string } | undefined;
        userTimezone = visitorGeneralSettings?.timezone;
      } else {
        const generalSettings = settings?.general as { timezone?: string } | undefined;
        userTimezone = generalSettings?.timezone;
      }
    } catch (error) {
      log('execAgent: failed to fetch user settings: %O', error);
    }
    try {
      const preference = await new UserModel(this.db, this.userId).getUserPreference();
      enableExpertise = preference?.lab?.enableSelfLearning === true;
    } catch (error) {
      console.error('Failed to resolve expertise injection Lab preference:', error);
    }
    // Share visitors only get the creator's memory (persona + learned
    // expertise) when the share explicitly allows it — both surfaces would
    // otherwise leak the creator's personal context into visitor turns.
    if (shareGate && !shareGate.shareConfig.allowReadMemory) {
      globalMemoryEnabled = false;
      enableExpertise = false;
    }
    log(
      'execAgent: globalMemoryEnabled=%s, timezone=%s',
      globalMemoryEnabled,
      userTimezone ?? 'default',
    );

    // History loader shared by tool discovery (media-availability probe) and
    // the operation-prep message assembly (see `pipeline/operationPrep`).
    const loadHistoryMessages = createHistoryMessagesLoader(
      {
        db: this.db,
        isShareVisitorRun: !!shareGate,
        messageModel: this.messageModel,
        userId: this.userId,
        workspaceId: this.workspaceId,
      },
      {
        appContext,
        effectiveResume,
        existingMessageIds,
        parentMessageId,
        resumeParentMessage,
        selfMessageIds,
      },
    );

    // When the user @-mentions agents (multi-mention, non-group), enable the
    // agent-management tool for this run so the supervisor can `callAgent` to
    // delegate. Mirrors the client runtime, which injects a callAgent manifest.
    // Single-mention takes a client-only deterministic-router path and never
    // reaches here. The delegation *context* (which agents were mentioned) is
    // injected separately via `initialContext.mentionedAgents` below.
    const hasMentionedAgents = !appContext?.groupId && !!mentionedAgents?.length;

    // Stage 5 (5a–5f) — tool discovery (see `pipeline/toolDiscovery`).
    const discovery = await discoverTools(
      {
        agentDocumentsService: this.agentDocumentsService,
        composioService: this.composioService,
        connectorModel: this.connectorModel,
        connectorToolModel: this.connectorToolModel,
        db: this.db,
        getMarketService: () => this.getMarketService(),
        messageModel: this.messageModel,
        pluginModel: this.pluginModel,
        userId: this.userId,
        workspaceId: this.workspaceId,
      },
      runContext,
      {
        additionalPluginIds,
        agentSlug,
        attachedFileIds,
        botContext,
        disableLocalSystem,
        disableSelfFeedbackIntentTool: params.disableSelfFeedbackIntentTool,
        disableTools: params.disableTools,
        disabledPluginIds,
        discordContext,
        exclusivePluginIds,
        files,
        functionTools,
        globalMemoryEnabled,
        hasMentionedAgents,
        isFixedDeviceTarget: turn.isFixedDeviceTarget,
        loadHistoryMessages,
        localDeviceId,
        requestTrigger: requestTriggerMetadata.trigger,
        requestedDeviceId,
        selectedToolIds,
        throwIfExecutionAborted,
        topicBoundDeviceId: turn.topicBoundDeviceId,
      },
    );

    // 15. Generate operation ID: agt_{timestamp}_{agentId}_{topicId}_{random}
    const timestamp = Date.now();
    const operationId =
      continuationOperationId ?? `op_${timestamp}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

    // Stages 9.4–18 — device system info, agent-management context, persona
    // memory, history + message assembly, the base initial runtime context,
    // workspace init, the OperationSkillSet, and the expertise snapshot
    // (see `pipeline/operationPrep`).
    const prep = await prepareOperation(
      {
        agentDocumentsService: this.agentDocumentsService,
        agentModel: this.agentModel,
        bindTopicWorkingDirectory: (p) => this.bindTopicWorkingDirectory(p),
        db: this.db,
        topicModel: this.topicModel,
        userId: this.userId,
        workspaceId: this.workspaceId,
      },
      runContext,
      {
        botPlatformContext,
        disabledPluginIds,
        discovery,
        ephemeralUserMessage,
        globalMemoryEnabled,
        hasMentionedAgents,
        loadHistoryMessages,
        mentionedAgents,
        operationId,
        runAttachments,
        runFromHistory,
        throwIfExecutionAborted,
      },
    );

    // 16b/16c — override the initial context with the human decision
    // (see `pipeline/approvalResume`). Pure; no-op on a fresh send.
    const initialContext = buildApprovalResumeContext({
      approvalOwnerAssistantId,
      approvedToolEntries,
      assistantMessageId: turn.assistantMessageId,
      initialContext: prep.initialContext,
      messageCount: prep.allMessages.length,
      operationId,
      parentMessageId,
      resumeApproval,
      resumeApprovalPlugin,
      resumeApprovals,
      resumeToolResult,
    });

    // 17. Log final operation parameters summary
    log(
      'execAgent: creating operation %s with params: model=%s, provider=%s, tools=%d, messages=%d, manifests=%d',
      operationId,
      model,
      provider,
      discovery.tools?.length ?? 0,
      prep.allMessages.length,
      Object.keys(discovery.toolManifestMap).length,
    );

    // Claim the child slot on the supervisor's runningOperation marker LAST,
    // immediately before startup. The marker vanishes when the supervisor is
    // cancelled or settled, so every awaited preparation step above widens the
    // claim→start race window — an orphaned child would start against a
    // marker that no longer lists it. Claiming here keeps the window minimal;
    // a failed claim only wastes the preparation reads (its lone write — the
    // topic cwd pin — is additive and idempotent).
    if (params.topicStartOwnerOperationId) {
      const attached = await this.topicModel.appendRunningOperationChild(
        topicId,
        params.topicStartOwnerOperationId,
        {
          assistantMessageId: turn.assistantMessageId,
          operationId,
          orchestrationRole: appContext?.orchestrationRole,
          scope: appContext?.scope ?? undefined,
          threadId: appContext?.threadId ?? undefined,
        },
      );
      if (!attached) {
        const errorMessage = 'Group supervisor finished before this member could start.';
        await updateAbortedAssistantMessage(errorMessage);
        return {
          agentId: resolvedAgentId,
          assistantMessageId: turn.assistantMessageId,
          autoStarted: false,
          createdAt: new Date().toISOString(),
          error: errorMessage,
          message: errorMessage,
          operationId,
          status: 'error',
          success: false,
          timestamp: new Date().toISOString(),
          topicId,
          userMessageId: turn.userMessageId ?? parentMessageId ?? '',
        };
      }
    }

    // 19. Create the operation via AgentRuntimeService, persist the reconnect
    // marker, and mint the gateway token (see `pipeline/startOperation`).
    return startOperation(
      {
        agentRuntimeService: this.agentRuntimeService,
        messageModel: this.messageModel,
        retirePendingApprovalOperation: (opId) => this.retirePendingApprovalOperation(opId),
        topicModel: this.topicModel,
        userId: this.userId,
        withholdGatewayToken: this.withholdGatewayToken,
        workspaceId: this.workspaceId,
      },
      runContext,
      {
        approvalClaim,
        approvalSourceOperationId,
        approvalSourceToolMessageIds,
        autoStart,
        botContext,
        botPlatformContext,
        clientIp,
        discordContext,
        discovery,
        enableExpertise,
        evalContext,
        evalRuntime,
        hooks,
        initialContext,
        initialStepCount,
        maxSteps,
        operationId,
        operationTaskId,
        parentOperationId,
        prep,
        providedApprovalResolutionRequestId,
        queueRetries,
        queueRetryDelay,
        signal,
        stream,
        topicStartOwnerOperationId: params.topicStartOwnerOperationId,
        updateAbortedAssistantMessage,
        userAgent,
        userInterventionConfig,
        userTimezone,
      },
    );
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
      const fallbackTitleSource = markdownToTxt(message);
      const topicTitle =
        newTopic?.title ||
        fallbackTitleSource.slice(0, 50) + (fallbackTitleSource.length > 50 ? '...' : '');
      const topicItem = await this.topicModel.create({
        agentId,
        groupId,
        messages: newTopic?.topicMessageIds,
        title: topicTitle,
        // Note: execGroupAgent doesn't have trigger param yet, defaults to null
      });
      topicId = topicItem.id;
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
  execSubAgent = async (params: ExecSubAgentParams): Promise<ExecSubAgentResult> =>
    execAgentThreadRun(this.subAgentRunDeps, params, {
      isSubAgent: false,
      logScope: 'execSubAgent',
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
      isSubAgent: true,
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
      // Isolated members reuse the sub-agent isolation-thread machinery, swapping
      // in the group-action member bridge (K=N barrier + resume/finish).
      const result = await execAgentThreadRun(
        this.subAgentRunDeps,
        {
          agentId: params.agentId,
          groupId: params.groupId,
          instruction: params.instruction ?? 'Please complete the assigned task.',
          parentMessageId: params.anchorMessageId,
          parentOperationId: params.parentOperationId,
          timeout: params.timeout,
          title: params.instruction?.slice(0, 50),
          topicId: params.topicId,
        },
        {
          bridgeHookFactory: (threadId) =>
            createGroupActionMemberBridgeHook(this.agentRuntimeService, {
              anchorMessageId: params.anchorMessageId,
              expectedMembers: params.expectedMembers,
              groupToolMessageId: params.groupToolMessageId,
              mode: 'isolated',
              onComplete: params.onComplete,
              parentOperationId: params.parentOperationId,
              threadId,
            }),
          isSubAgent: true,
          logScope: 'execVirtualSubAgent',
          // Tag the op as a group member so the abandon path routes its parent
          // resume through the group bridge (its own timeout), not the sub-agent one.
          orchestrationRole: 'member',
          resumeParentOnComplete: true,
        },
      );

      // Enforce the requested timeout: if the member op is still running when the
      // deadline passes, the watchdog interrupts it and bridges a `timeout`
      // completion so the supervisor doesn't stay parked indefinitely.
      if (result.success && result.operationId && params.timeout && params.timeout > 0) {
        await this.agentRuntimeService.scheduleGroupMemberTimeout(
          {
            anchorMessageId: params.anchorMessageId,
            expectedMembers: params.expectedMembers,
            groupToolMessageId: params.groupToolMessageId,
            memberOperationId: result.operationId,
            mode: 'isolated',
            onComplete: params.onComplete,
            parentOperationId: params.parentOperationId,
          },
          params.timeout,
        );
      }

      return {
        error: result.error,
        operationId: result.operationId,
        started: result.success ?? false,
        threadId: result.threadId,
      };
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
