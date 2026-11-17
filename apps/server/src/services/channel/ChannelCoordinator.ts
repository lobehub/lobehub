import { ChannelIdentifier } from '@lobechat/builtin-tool-channel';
import type { LobeChatDatabase } from '@lobechat/database';
import { buildChannelPrompt, CHANNEL_INSTRUCTIONS } from '@lobechat/prompts';
import type { ChannelExecutionConfig, ChannelSharedAgentAccess } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { and, eq, inArray } from 'drizzle-orm';
import { groupBy } from 'es-toolkit';
import pMap from 'p-map';

import { checkAgentShareSpendAllowance } from '@/business/server/agent-share/spendGate';
import { getServerDB } from '@/database/core/db-adaptor';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { AgentShareModel } from '@/database/models/agentShare';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type { ChannelClaim, ChannelCoAddressedAgent } from '@/database/repositories/channel';
import { ChannelExecutionRepository } from '@/database/repositories/channel';
import { agentOperations, channelJobs, channelMembers, channels } from '@/database/schemas';
import { getServerDefaultAgentConfig } from '@/server/globalConfig';
import { extractTextFromMessage } from '@/server/services/agentRuntime/CompletionLifecycle/messageContent';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { AiAgentService } from '@/server/services/aiAgent';
import type { AgentShareGate } from '@/server/services/aiAgent/shareGate';
import { resolveShareVisitorDeviceAccess } from '@/server/services/aiAgent/shareGate/deviceAccess';
import { detectNoReply } from '@/server/services/conversationWake/noReply';
import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';
import { SystemAgentService } from '@/server/services/systemAgent';

import { reportAgentExchange } from './agentExchange';
import { resolveChannelAttachments } from './attachments';
import { ChannelRoutingService } from './ChannelRoutingService';
import { notifyChannel } from './notify';
import { registerLocalChannelAdvance, wakeChannel } from './queue';
import { deliverRelayReceipt } from './relayReceipt';
import { openChannelReply } from './replyOpening';
import { createRoutedDevicePresence, resolveChannelRoutedDevice } from './routedDevice';
import { createChannelWorktree } from './worktree';

const LEASE_MS = 60_000;

/** A co-addressed Agent as the run reads it: its name, and its title when that says more. */
const describePeer = (agent: ChannelCoAddressedAgent) => {
  const name = agentDisplayName(agent);
  return name && agent.title && agent.title !== name ? `${name} (${agent.title})` : name;
};
// Limit startup IO, not the number of Agents that may execute concurrently.
const STARTUP_CONCURRENCY = 5;

/** Source-side coordination. Both Native and Codex execute through the ordinary Agent pipeline. */
export class ChannelCoordinator {
  private readonly executions: ChannelExecutionRepository;

  constructor(private readonly db: LobeChatDatabase) {
    this.executions = new ChannelExecutionRepository(db);
  }

  /** A shared Agent's run is its owner's, on topics tagged with the requester as sender. */
  private service(userId: string, workspaceId: string | null, shared?: boolean) {
    return new AiAgentService(this.db, userId, {
      ...(shared ? { includeShareVisitor: true } : {}),
      workspaceId: workspaceId ?? undefined,
    });
  }

  /**
   * Recheck a shared Agent's live share and its owner's spend limit right before submission, as
   * the share page does for every visitor turn, and build the gate the run executes under.
   */
  private async shareGate(
    access: ChannelSharedAgentAccess,
    agentId: string,
    requesterId: string,
  ): Promise<AgentShareGate> {
    const share = await AgentShareModel.findByShareId(this.db, access.shareId);
    if (
      !share ||
      share.visibility !== 'link' ||
      share.agentId !== agentId ||
      share.ownerId !== access.ownerId
    )
      throw new Error('This Agent is no longer shared');
    const spend = await checkAgentShareSpendAllowance({
      agentId,
      monthlySpendLimit: share.shareConfig.monthlySpendLimit,
      ownerUserId: share.ownerId,
      shareId: share.shareId,
      visitorUserId: requesterId,
      workspaceId: share.workspaceId ?? undefined,
    });
    if (!spend.allowed) throw new Error('This shared Agent reached its monthly usage limit');
    return {
      agentId,
      canUseDevice: await resolveShareVisitorDeviceAccess(this.db, share.shareConfig, requesterId),
      shareConfig: share.shareConfig,
      shareId: share.shareId,
      visitorUserId: requesterId,
    };
  }

  advance = async (channelId: string) => {
    const [channel] = await this.db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel) return;
    if (!channel.isDeleted && channel.status === 'active')
      await new ChannelRoutingService(this.db).advance(channelId);
    const { heads, inFlight } = await this.executions.candidates(channelId);
    const pending = [...inFlight, ...heads];

    // Persist recovery before dispatch; a worker can die after the device accepts a run.
    if (pending.length) await wakeChannel(channelId, LEASE_MS);

    const members = heads.length
      ? await this.db
          .select({ config: channelMembers.config, id: channelMembers.id })
          .from(channelMembers)
          .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.status, 'active')))
      : [];
    // A member with no device picked in the Channel runs where the Agent's own settings say, as
    // its requester: their presence decides whether that device is online. Read it here, outside
    // the channel lock; the claim only resolves which device it is.
    const unpicked = new Set(
      members.filter(({ config }) => !config?.deviceId).map((member) => member.id),
    );
    const requesterIds = [
      ...new Set(
        heads.filter((job) => unpicked.has(job.memberId)).map((job) => job.requesterMemberId),
      ),
    ];
    const requesters = requesterIds.length
      ? await this.db
          .select({ userId: channelMembers.userId })
          .from(channelMembers)
          .where(
            and(eq(channelMembers.channelId, channelId), inArray(channelMembers.id, requesterIds)),
          )
      : [];
    const routedPresence = createRoutedDevicePresence(this.db, channel.workspaceId);
    await pMap(
      requesters.flatMap(({ userId }) => (userId ? [userId] : [])),
      (userId) => routedPresence.prefetch(userId),
      { concurrency: 5 },
    );
    const owners = [
      ...new Set(
        members.flatMap(({ config }) => (config?.deviceOwnerId ? [config.deviceOwnerId] : [])),
      ),
    ];
    const presence = await pMap(
      owners,
      (owner) => getScopedOnlineDevices(this.db, owner, channel.workspaceId ?? undefined),
      { concurrency: 5 },
    );
    const onlineDeviceIds = presence
      .flat()
      .filter((device) => device.online)
      .map((device) => device.deviceId);

    try {
      await pMap(
        Object.values(groupBy(pending, (job) => `${job.memberId}:${job.threadId ?? ''}`)),
        async (jobs) => {
          // Recover a branch's earlier runs before claiming in it, without delaying other
          // members or the member's other branches.
          for (const job of jobs) {
            if (job.status !== 'queued') {
              await this.complete(channelId, job.id, job.operationId ?? undefined);
              continue;
            }
            // Before the claim: a reply that moves into a Thread runs there from the start.
            await openChannelReply(this.db, channelId, job.id);
            const claimNow = () =>
              this.executions.claim(channelId, job.id, {
                leaseMs: LEASE_MS,
                leaseOwner: crypto.randomUUID(),
                onlineDeviceIds,
                routedDevice: (run) => resolveChannelRoutedDevice(this.db, run, routedPresence),
                serverDefaultAgentConfig: getServerDefaultAgentConfig(),
              });
            let claim = await claimNow();
            if (
              !claim &&
              (await this.moveToWorktree(channelId, job.id, channel.workspaceId, onlineDeviceIds))
            )
              claim = await claimNow();
            await Promise.all([
              notifyChannel(this.db, channelId),
              claim ? this.dispatch(claim, channel.workspaceId, channel.projectId) : undefined,
            ]);
          }
        },
        { concurrency: STARTUP_CONCURRENCY, stopOnError: false },
      );
    } finally {
      if (pending.length) await notifyChannel(this.db, channelId);
    }
  };

  /**
   * A job held back only because another run uses its member's directory moves its branch into
   * a worktree of that directory instead of waiting. Returns whether the branch got one; a
   * directory that cannot host one (not a git repo, device too old) keeps the job waiting.
   */
  private async moveToWorktree(
    channelId: string,
    jobId: string,
    workspaceId: string | null,
    onlineDeviceIds: string[],
  ) {
    const candidate = await this.executions.worktreeCandidate(channelId, jobId);
    if (!candidate || !onlineDeviceIds.includes(candidate.deviceId)) return false;
    // A device call, so it runs outside the channel lock; assignment rechecks the member.
    const created = await createChannelWorktree(candidate, workspaceId);
    if (created.path === undefined) {
      await this.executions.worktreeUnavailable(channelId, candidate, created.error);
      return false;
    }
    return this.executions.assignWorktree(channelId, candidate, created.path);
  }

  /**
   * `projectId` is the Channel's own project (`channels.projectId`), not one inferred
   * from the Agent: a Channel that belongs to a project runs inside it. It travels as
   * `appContext.projectId` so the run gets the project prompt, is recognised as the
   * project coordinator, and files the tasks it creates under the project.
   */
  private async dispatch(
    { job, member, topic }: ChannelClaim,
    channelWorkspaceId: string | null,
    channelProjectId?: string | null,
  ) {
    if (
      !job.operationId ||
      !job.leaseOwner ||
      !job.manifest ||
      !job.executionConfig ||
      !member.agentId ||
      !topic.userId
    )
      throw new Error('Incomplete Channel execution claim');
    const config: ChannelExecutionConfig = structuredClone(job.executionConfig);
    const { share } = config;
    // A shared Agent runs in its owner's scope, never the Channel's, and outside its projects.
    const workspaceId = share ? share.workspaceId : channelWorkspaceId;
    const projectId = share ? undefined : channelProjectId;
    // A device a member picked for this Agent in the Channel is authoritative for the run.
    // Without one the Channel binds nothing: the Agent runs where its own settings say, as the
    // requester's ordinary conversation with it would.
    if (config.deviceId)
      config.agencyConfig = {
        ...config.agencyConfig,
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
        boundDeviceId: config.deviceId,
        workingDirByDevice: config.workingDirectory
          ? { [config.deviceId]: config.workingDirectory }
          : {},
      };
    const completion: AgentHook = {
      id: `channel:${job.id}`,
      type: 'onComplete',
      ...(isQueueAgentRuntimeEnabled()
        ? {
            webhook: {
              url: '/api/agent/webhooks/channel-callback',
              delivery: 'qstash' as const,
              fallback: 'none' as const,
              body: { channelId: job.channelId, jobId: job.id },
            },
          }
        : {
            handler: async () => {
              await this.complete(job.channelId, job.id, job.operationId!);
              await wakeChannel(job.channelId);
            },
          }),
    };
    // Keep the lease while this call is alive. Once it expires it cannot be renewed, and
    // recovery may revoke it; see `revokeExpiredLease`.
    const lease = { leaseMs: LEASE_MS, leaseOwner: job.leaseOwner };
    const renew = setInterval(() => {
      this.executions
        .heartbeat(job.id, lease)
        .catch((error) => console.error('[channel:heartbeat]', error));
    }, LEASE_MS / 3);
    try {
      if (config.runtime === 'native' && config.deviceId) {
        const scope = await deviceGateway.executeToolCall(
          {
            deviceId: config.deviceId,
            operationId: job.operationId,
            userId: config.deviceOwnerId ?? topic.userId,
            workspaceId: workspaceId ?? undefined,
          },
          { apiName: 'beginNativeOperation', arguments: '{}', identifier: 'lobe-local-system' },
        );
        if (!scope.success || !isRecord(scope.state) || scope.state.registered !== true)
          throw new Error(
            (isRecord(scope.state) && scope.state.registered === false && scope.content) ||
              'Device cannot track Native operation lifetime; update its client',
          );
      }
      const [input, context, primaryReply, opening, coAddressed] = await Promise.all([
        this.executions.input(job.channelId, job.id),
        this.executions.recentContext(job.channelId, job.id),
        this.executions.primaryReply(job.channelId, job.id),
        this.executions.openingReply(job.channelId, job.id),
        this.executions.coAddressed(job.channelId, job.id),
      ]);
      const shareGate =
        share && topic.senderId
          ? await this.shareGate(share, member.agentId, topic.senderId)
          : undefined;
      if (share && !shareGate) throw new Error('A shared Agent run needs its requester');
      // Sending refuses attachments to a shared Agent: the owner's run cannot read them.
      const attachments = share
        ? {}
        : await resolveChannelAttachments(this.db, topic.userId, workspaceId, input);
      // The last check before submission. A dispatcher that stalled past its lease stops
      // here; one that already passed it can only consume the still-idle reservation.
      if (!(await this.executions.heartbeat(job.id, lease)))
        throw new Error('The Channel dispatch lease expired before submission');
      const result = await this.service(topic.userId, workspaceId, !!share).execAgent({
        additionalPluginIds: [ChannelIdentifier],
        agentId: member.agentId,
        agentConfigSnapshot: config,
        // No device picked in the Channel: the requester's own device for this Agent applies.
        snapshotFollowsCallerDevice: !config.deviceId,
        appContext: { ...(projectId ? { projectId } : {}), topicId: topic.id },
        deviceId: config.deviceId,
        ...attachments,
        hooks: [completion],
        instructions: CHANNEL_INSTRUCTIONS,
        maxSteps: 32,
        prompt: buildChannelPrompt(job.manifest, input, {
          context: context.messages,
          omitted: context.omitted,
          opening,
          peers: coAddressed.map(describePeer).filter((peer): peer is string => !!peer),
          primaryReply,
          wake: job.wake,
        }),
        reservedOperationId: job.operationId,
        shareGate,
        trigger: 'channel',
        userInterventionConfig: { approvalMode: 'headless' },
      });
      if (!result.success) throw new Error(result.error || 'Agent could not start');
      await this.executions.accepted(job.channelId, job.id);
    } catch (error) {
      console.error('[channel:dispatch]', error);
      const operation = await new AgentOperationModel(
        this.db,
        topic.userId,
        workspaceId ?? undefined,
      ).findById(job.operationId);
      if (operation?.status === 'idle') {
        await this.executions.retireReservation(job.channelId, job.id);
      } else
        await this.executions.fail(job.channelId, job.id, {
          message: error instanceof Error ? error.message : 'Agent could not start',
        });
    } finally {
      clearInterval(renew);
      await this.executions.finishDispatch(job.channelId, job.id, lease.leaseOwner);
      await notifyChannel(this.db, job.channelId);
      await wakeChannel(job.channelId);
    }
  }

  /** Callbacks carry identity only; read the authoritative final reply from ordinary storage. */
  complete = async (channelId: string, jobId: string, operationId?: string) => {
    const [row] = await this.db
      .select({ job: channelJobs, operation: agentOperations })
      .from(channelJobs)
      .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
      .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, jobId)))
      .limit(1);
    if (!row || !operationId || row.job.operationId !== operationId) return;
    const { job, operation } = row;
    if (!operation || !job.manifest) return;
    if (
      operation.status === 'idle' &&
      job.leaseExpiresAt &&
      job.leaseExpiresAt.getTime() < Date.now()
    ) {
      // A reservation that was never started can be retired. Its old dispatcher cannot
      // initialise this now-terminal operation, even if it resumes after a process stall.
      await this.executions.retireReservation(channelId, jobId);
      return;
    }
    if (job.publicationRevoked && operation.status !== 'done') {
      await this.stopWriters([job]);
      return;
    }
    if (operation.status === 'done') {
      // Already settled in silence: there is no draft to publish, only the writer to release.
      if (job.status === 'silent') {
        await this.stopWriters([job]);
        return;
      }
      if (job.publicationRevoked) {
        await this.stopWriters([job]);
        return;
      }
      let reply = job.draft;
      if (job.draft === null) {
        if (!operation.userId || !job.topicId) return;
        const final = await new MessageModel(
          this.db,
          operation.userId,
          operation.workspaceId ?? undefined,
          undefined,
          job.executionConfig?.share ? { includeShareVisitor: true } : undefined,
        ).findLatestAssistantByOperationId({ operationId, topicId: job.topicId });
        const content = final?.tools?.length ? undefined : extractTextFromMessage(final);
        // A wake nobody asked for may end in silence. Settled like a reply, not a failure.
        // A run that stopped on a tool call (out of steps) did not choose silence: it failed.
        const silence = final?.tools?.length
          ? undefined
          : detectNoReply({ content, wakeKind: job.wake?.kind });
        if (silence && (await this.executions.silence(channelId, jobId, silence.reason))) {
          await this.stopWriters([job]);
          await notifyChannel(this.db, channelId);
          return;
        }
        if (!content?.trim()) {
          await this.stopWriters([job]);
          await notifyChannel(this.db, channelId);
          return;
        }
        await this.executions.accepted(channelId, jobId);
        await this.executions.saveDraft(channelId, jobId, content);
        reply = content;
      }
      const replyMessageId = await this.executions.publish(channelId, jobId);
      await this.stopWriters([job]);
      await notifyChannel(this.db, channelId);
      // Between Agents, an answer wakes the Agent that asked, and what that Agent concludes from
      // it is posted where its asking began.
      if (await this.executions.deliverAnswerToAsker(channelId, replyMessageId))
        await wakeChannel(channelId);
      await reportAgentExchange(this.db, { channelId, jobId, replyMessageId }).catch((error) =>
        console.error('[channel:agent-exchange]', error),
      );
      // A reply to a relayed request also goes back to the Agent that relayed it.
      await deliverRelayReceipt(this.db, { channelId, jobId, replyMessageId }).catch((error) =>
        console.error('[channel:relay-receipt]', error),
      );
      this.summarizeTopicTitle(channelId, jobId, {
        lastAssistantContent: reply,
        topicId: job.topicId,
        userId: operation.userId,
        workspaceId: operation.workspaceId,
      });
    } else if (['error', 'interrupted', 'abandoned'].includes(operation.status)) {
      await this.executions.fail(channelId, jobId, {
        message: 'Agent execution ended without a reply',
      });
      if (job.writerHeld) await this.stopWriters([job]);
      // Device cancellation/unknown outcomes keep the physical writer until confirmed by stop.
    }
  };

  /**
   * Names a responder's topic after its first published reply, as the bot callback does. The
   * title comes from the request itself: the topic's user message is the wrapped Channel prompt.
   * Best-effort, so it never affects delivery.
   */
  private summarizeTopicTitle(
    channelId: string,
    jobId: string,
    {
      lastAssistantContent,
      topicId,
      userId,
      workspaceId,
    }: {
      lastAssistantContent: string | null;
      topicId: string | null;
      userId: string | null;
      workspaceId: string | null;
    },
  ): void {
    if (!lastAssistantContent || !topicId || !userId) return;

    const topicModel = new TopicModel(this.db, userId, workspaceId ?? undefined);
    topicModel
      .findById(topicId)
      .then(async (topic) => {
        if (topic?.title) return;

        const input = await this.executions.input(channelId, jobId);
        const userPrompt = input.map((message) => message.content).join('\n');
        if (!userPrompt) return;

        const title = await new SystemAgentService(
          this.db,
          userId,
          workspaceId ?? undefined,
        ).generateTopicTitle({ lastAssistantContent, topicId, userPrompt });
        if (!title) return;

        await topicModel.update(topicId, { title });
        // Viewers read the title from the Channel view, which was sent before it existed.
        await notifyChannel(this.db, channelId);
      })
      .catch((error) => {
        console.error('[channel:summarizeTopicTitle]', error);
      });
  }

  stopWriters = async (
    jobs: Array<{ channelId: string; id: string; operationId: string | null }>,
  ) => {
    for (const job of jobs) {
      if (!job.operationId) continue;
      const [row] = await this.db
        .select({ operation: agentOperations, config: channelJobs.executionConfig })
        .from(agentOperations)
        .innerJoin(channelJobs, eq(channelJobs.operationId, agentOperations.id))
        .where(eq(agentOperations.id, job.operationId));
      if (!row?.operation.userId) continue;
      if (await this.executions.retireReservation(job.channelId, job.id)) continue;
      // Cancellation must not release the writer while a dispatcher can still submit
      // its network request. An operation result alone does not prove device exit.
      const [current] = await this.db.select().from(channelJobs).where(eq(channelJobs.id, job.id));
      if (!current?.writerHeld) continue;
      // A dispatcher that died before settling leaves its lease behind. Once expired, revoke
      // it and still require the device to confirm termination below.
      const dispatch = current.leaseOwner
        ? await this.executions.revokeExpiredLease(job.channelId, job.id)
        : 'settled';
      if (dispatch === 'live') continue;
      // A Native run, or any run with no device picked in the Channel, went through the
      // ordinary pipeline, which knows where it routed the run; stop it there. Only a run on a
      // device picked in the Channel needs that device to confirm the external process exited.
      if (row.config?.runtime === 'native' || !row.config?.deviceId) {
        const result = await this.service(
          row.operation.userId,
          row.operation.workspaceId,
          !!row.config?.share,
        ).interruptTask({
          operationId: job.operationId,
          topicId: row.operation.topicId ?? undefined,
        });
        // The ordinary pipeline may have run it on a device. A terminal status does not prove that
        // process exited (a lost acknowledgement can fail the operation while it runs on), so an
        // unconfirmed device cancellation keeps the writer, as for a device picked in the Channel.
        if (result.deviceCancellationConfirmed === false) continue;
        if (
          !result.success &&
          !['done', 'error', 'interrupted', 'abandoned'].includes(row.operation.status)
        )
          continue;
        if (row.config?.runtime === 'native' && row.config.deviceId) {
          const stopped = await deviceGateway.executeToolCall(
            {
              deviceId: row.config.deviceId,
              operationId: job.operationId,
              userId: row.config.deviceOwnerId ?? row.operation.userId,
              workspaceId: row.operation.workspaceId ?? undefined,
            },
            { apiName: 'cancelNativeOperation', arguments: '{}', identifier: 'lobe-local-system' },
            10_000,
          );
          if (!stopped.success || !isRecord(stopped.state) || stopped.state.exited !== true)
            continue;
        }
        await this.executions.releaseWriter(job.channelId, job.id);
      } else {
        // Use the frozen identity even if runtime cleanup already removed the topic marker.
        const result = await deviceGateway.executeToolCall(
          {
            deviceId: row.config.deviceId,
            userId: row.config.deviceOwnerId ?? row.operation.userId,
            workspaceId: row.operation.workspaceId ?? undefined,
          },
          {
            apiName: 'cancelHeteroTask',
            arguments: JSON.stringify({ signal: 'SIGINT', taskId: job.operationId }),
            identifier: 'cancelHeteroTask',
          },
          10_000,
        );
        const exited = result.success && isRecord(result.state) && result.state.exited === true;
        // "No such process" proves nothing while a revoked dispatcher may still submit the
        // start late, and the device keeps no record that would refuse it. Only a run the
        // device itself reported done shows that the one submission already arrived.
        const unseen = isRecord(result.state) && result.state.reason === 'not_found';
        if (exited && (dispatch !== 'revoked' || !unseen || row.operation.status === 'done'))
          await this.executions.releaseWriter(job.channelId, job.id);
      }
    }
  };
}

registerLocalChannelAdvance(async (channelId) => {
  await new ChannelCoordinator(await getServerDB()).advance(channelId);
});
