import { TopicToolIdentifier } from '@lobechat/builtin-tool-topic';
import {
  type SubTopicToolService,
  TopicToolExecutionRuntime,
} from '@lobechat/builtin-tool-topic/executionRuntime';
import type { ChatTopicMetadata } from '@lobechat/types';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import {
  assertCanUseTopicTargets,
  assertCanViewTopicTargets,
} from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import { agentSteerQueueRouter } from '@/server/routers/lambda/agentSteerQueue';
import { assertCanUseAgentRunConversation } from '@/server/routers/lambda/aiAgent/guards';
import {
  onlyViewableChildTopics,
  retireChildTopics,
  RETIRED_TOPIC_STATUSES,
  toSubTopicState,
} from '@/server/routers/lambda/topic/childTopics';
import { readTopicTranscript } from '@/server/routers/lambda/topic/transcript';
import { AiAgentService } from '@/server/services/aiAgent';
import { startComposerRun } from '@/server/services/aiAgent/composerRun';
import { runDeniesDevices } from '@/server/services/aiAgent/deviceAccessPolicy';
import { resolveForegroundInterventionConfig } from '@/server/services/aiAgent/foregroundIntervention';
import { findOwnLiveRuns } from '@/server/services/aiAgent/steerQueue/liveRuns';
import { readSubTopicsEnabled } from '@/server/services/subTopic/labGate';
import { TopicArchiveService } from '@/server/services/topicArchive';
import { TrashService } from '@/server/services/trash';

import type { ServerRuntimeRegistration } from './types';

/** How far back `getTopic` looks for the sub-topic's last reply. */
const LAST_REPLY_WINDOW = 20;

/**
 * `lobe-topic`: the agent opens and manages sub-topics of the conversation it
 * runs in. A sub-topic is an ordinary topic with a parent, so every call goes
 * through the entries the app and `lh topic` use — `execAgent` with
 * `openedByTopicId`, the steer queue, the transcript, `interruptTask`, the
 * topic archive — under the same permission checks.
 */
export const subTopicRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for the sub-topic tool');
    }
    const db = context.serverDB;
    const userId = context.userId;
    const workspaceId = context.workspaceId ?? undefined;
    const guard = { db, userId, workspaceId };
    const topicModel = new TopicModel(db, userId, workspaceId);
    const aiAgent = () => new AiAgentService(db, userId, { workspaceId });

    // A sub-topic turn runs as the account owner, without the IM sender's
    // provenance, so it would get the owner's devices. A sender this
    // conversation denies devices (an external one in a bot chat) must not
    // start one; a shared-agent visitor's run is the creator's identity too.
    const assertMayStartRuns = () => {
      if (context.agentShareVisitor) {
        throw new Error('Sub-topics cannot be started from a shared agent conversation.');
      }
      // The run's own device decision covers every source of a denial (an
      // IM sender, a share visitor, a device-denied run that started this one
      // through `lh`); the sender check backs it up for a run without one.
      if (runDeniesDevices(context)) {
        throw new Error(
          'Sub-topics can only be started or continued by the bot owner or a trusted sender in this chat.',
        );
      }
    };

    const requireTopic = async (topicId: string) => {
      const topic = await topicModel.findById(topicId);
      if (!topic) throw new Error(`Topic ${topicId} not found.`);
      return topic;
    };

    const interrupt = async (topicId: string) => {
      const runIds = await findOwnLiveRuns(
        { db, workspaceId },
        { threadId: null, topicId, userId },
      );
      let stopped = 0;
      for (const operationId of runIds) {
        const result = await aiAgent().interruptTask({ operationId, topicId });
        if (result.success) stopped += 1;
      }
      if (stopped < runIds.length) {
        throw new Error(
          `${runIds.length - stopped} run(s) of ${topicId} could not be confirmed stopped (a device may still be running them); try again once it is reachable.`,
        );
      }
      return stopped;
    };

    const readLastReply = async (topicId: string) => {
      const messages = new MessageModel(db, userId, workspaceId);
      const { total } = await messages.queryTopicTranscript({ limit: 1, offset: 0, topicId });
      const { items } = await messages.queryTopicTranscript({
        limit: LAST_REPLY_WINDOW,
        offset: Math.max(0, (total ?? 0) - LAST_REPLY_WINDOW),
        topicId,
      });
      const last = [...items]
        .reverse()
        .find((item: any) => item.role === 'assistant' && typeof item.content === 'string');
      const content = (last as { content?: string } | undefined)?.content?.trim();
      return content ? content.slice(0, 2000) : undefined;
    };

    const adapter: SubTopicToolService = {
      archive: async (topicId) => {
        await assertCanUseTopicTargets(guard, [topicId]);
        // Its own sub-topics move to the top level, as "archive only this one" does.
        await retireChildTopics(
          {
            serverDB: db,
            topicModel,
            trashService: new TrashService(db, userId, workspaceId),
            userId,
            workspaceId,
          },
          { action: 'archive', mode: 'detach', topicId },
        );
        await new TopicArchiveService(db, userId, workspaceId).updateTopic(topicId, {
          completedAt: new Date(),
          status: 'completed',
        });
        return { topicId };
      },
      get: async (topicId) => {
        const topic = await requireTopic(topicId);
        await assertCanViewTopicTargets(guard, [topicId]);
        const [liveRuns, latestRunStatus] = await Promise.all([
          findOwnLiveRuns({ db, workspaceId }, { threadId: null, topicId, userId }),
          topicModel.getLatestRunStatus(topicId),
        ]);
        // The latest run says running / waiting / failed; a live run that has
        // not written its status yet still counts as running.
        const fromRun = toSubTopicState(topic.status as any, latestRunStatus);
        return {
          agentId: topic.agentId,
          lastReply: await readLastReply(topicId),
          state: fromRun === 'idle' && liveRuns.length > 0 ? 'running' : fromRun,
          title: topic.title,
          topicId,
        };
      },
      isOpenedBy: (topicId, openerTopicId) => topicModel.isOpenedBy(topicId, openerTopicId),
      list: async (openerTopicId) => {
        await assertCanViewTopicTargets(guard, [openerTopicId]);
        // Another member's private agent's sub-topics stay out, as in the sidebar.
        const rows = await onlyViewableChildTopics(
          guard,
          await topicModel.listOpenedTopics({
            excludeStatuses: RETIRED_TOPIC_STATUSES,
            openerTopicIds: [openerTopicId],
          }),
        );
        return rows.map((row) => ({
          agentId: row.agentId,
          state: toSubTopicState(row.status, row.latestRunStatus),
          title: row.title,
          topicId: row.id,
        })) as any;
      },
      open: async (params) => {
        if (!(await readSubTopicsEnabled(db, userId))) {
          throw new Error('Sub-topics need Labs → Better Coding Experience, which is off.');
        }
        assertMayStartRuns();
        const parent = await requireTopic(params.openerTopicId);
        // A group conversation keeps its own collaboration: a sub-topic linked
        // to it would never report back (see `deliverSubTopicReceipt`).
        if (parent.groupId && !params.detach) {
          throw new Error(
            'A group conversation cannot open linked sub-topics: their replies are not reported back here. Use the group tools, or detach: true for an independent topic.',
          );
        }
        // "Yourself" is the agent running this call — under `callAgent` that is
        // not the topic's own agent.
        const agentId = params.agentId || context.agentId || parent.agentId;
        if (!agentId) throw new Error('Name the agent to open the sub-topic with.');
        // What `aiAgent.execAgent` checks: the agent, and the parent the new topic hangs off.
        await assertCanUseWorkspaceAgent({ agentId, db, userId, workspaceId });
        await assertCanUseAgentRunConversation({
          db,
          openedByTopicId: params.detach ? undefined : parent.id,
          userId,
          workspaceId,
        });

        const result = await aiAgent().execAgent({
          agentId,
          ...(params.deviceId && { deviceId: params.deviceId, requireDevice: true }),
          // Detached: a plain topic, not linked and never reporting back.
          ...(!params.detach && {
            openedByTopicId: parent.id,
            parentWorkspace: params.workspace ?? 'inherit',
            ...(params.baseBranch && { parentWorkspaceBaseBranch: params.baseBranch }),
          }),
          prompt: params.prompt,
          ...(params.sourceOperationId && { sourceOperationId: params.sourceOperationId }),
          ...(params.title && { title: params.title }),
          userInterventionConfig: await resolveForegroundInterventionConfig(db, userId),
        } as any);
        if (!result.success || !result.topicId) {
          throw new Error(`Failed to start the sub-topic: ${result.error || 'unknown error'}`);
        }
        const created = (await topicModel.findById(result.topicId))?.metadata as
          ChatTopicMetadata | undefined;
        return {
          agentId,
          branch:
            params.workspace === 'new-worktree'
              ? created?.workingDirectoryConfig?.git?.branch
              : undefined,
          operationId: result.operationId ?? undefined,
          topicId: result.topicId,
          workingDirectory: created?.workingDirectory,
        } as any;
      },
      read: async (topicId, limit) => {
        await assertCanViewTopicTargets(guard, [topicId]);
        const head = await readTopicTranscript(guard, {
          includeMessages: true,
          limit: 1,
          offset: 0,
          topicId,
        });
        return readTopicTranscript(guard, {
          includeMessages: true,
          limit,
          offset: Math.max(0, (head.total ?? 0) - limit),
          topicId,
        }) as any;
      },
      // Start a turn when the sub-topic is idle, otherwise queue it behind the
      // running turn (the user's Queue / Steer behavior applies). Never interrupts.
      send: async (params) => {
        assertMayStartRuns();
        const topic = await requireTopic(params.topicId);
        if (!topic.agentId) throw new Error(`Topic ${topic.id} belongs to no agent.`);
        const request = {
          agentId: topic.agentId,
          appContext: { topicId: topic.id },
          prompt: params.message,
          ...(params.sourceOperationId && { sourceOperationId: params.sourceOperationId }),
          userInterventionConfig: await resolveForegroundInterventionConfig(db, userId),
        };
        const queue = agentSteerQueueRouter.createCaller({
          serverDB: db,
          userId,
          workspaceId,
        } as any);

        for (let attempt = 0; attempt < 3; attempt += 1) {
          // The append authorizes the agent and the conversation, like execAgent.
          // No entry id: one would make it read Redis before liveness, so an
          // idle sub-topic could not start on a deployment without Redis.
          let queued: { queued: boolean; reason?: string };
          try {
            queued = (await queue.append({ request } as any)) as typeof queued;
          } catch (error) {
            if ((error as { code?: string })?.code !== 'SERVICE_UNAVAILABLE') throw error;
            // The queue cannot say whether the message was stored (a write
            // whose answer was lost, or no queue at all): a blind resend could
            // run it twice, so the agent checks before sending again.
            throw new Error(
              `Topic ${topic.id} is running a turn and the queue could not confirm whether this message was stored behind it. Do not resend it blindly: once that turn ends, check the sub-topic with readTopic and send again only if the message is not there.`,
              { cause: error },
            );
          }
          if (queued.queued) return { delivery: 'queued' as const };
          if (queued.reason !== 'idle') {
            throw new Error(
              queued.reason === 'full'
                ? `Topic ${topic.id} already has too many messages waiting; try again after its turn ends.`
                : `Could not queue the message behind the running turn of ${topic.id}; try again.`,
            );
          }
          try {
            const started = await startComposerRun(
              {
                aiAgentService: aiAgent(),
                db,
                supersedeLiveRun: false,
                userId,
                workspaceId,
              },
              { ...(request as any), queuedSuccessor: true },
            );
            if (!(started as any).success) {
              throw new Error(
                `Failed to start ${topic.id}: ${(started as any).error || 'unknown error'}`,
              );
            }
            return { delivery: 'started' as const };
          } catch (error) {
            // A turn began after the queue saw the topic idle: queue behind it instead.
            if ((error as Error)?.name !== 'TopicStartReservationError') throw error;
          }
        }
        throw new Error(`Topic ${topic.id} kept starting new turns; try again.`);
      },
      stop: async (topicId) => {
        await assertCanUseTopicTargets(guard, [topicId]);
        return { stopped: await interrupt(topicId) };
      },
    };

    return new TopicToolExecutionRuntime(adapter, {
      operationId: context.operationId,
      topicId: context.topicId,
    });
  },
  identifier: TopicToolIdentifier,
};
