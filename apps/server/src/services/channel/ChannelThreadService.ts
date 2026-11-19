import { createHash } from 'node:crypto';

import type {
  ChannelCreatedThread,
  ChannelCreateThreadParams,
  ChannelListThreadsParams,
  ChannelMessageVia,
  ChannelSteeredThread,
  ChannelSteerThreadParams,
  ChannelStoppedThread,
  ChannelStopThreadParams,
  ChannelThreadPage,
  ChannelUnwatchThreadsParams,
  ChannelWatchedThreads,
  ChannelWatchThreadsParams,
} from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import debug from 'debug';
import { and, eq, inArray } from 'drizzle-orm';

import { ChannelError, ChannelHistoryRepository } from '@/database/repositories/channel';
import { channelJobs, channelMembers, channelMessages, channelThreads } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import type { QueuedFollowUp } from '@/server/services/aiAgent/steerQueue';
import { readFollowUpMode } from '@/server/services/aiAgent/steerQueue/followUpMode';
import { isRunAlive } from '@/server/services/aiAgent/steerQueue/liveRuns';
import { QueueService } from '@/server/services/queue';
import { redisService } from '@/server/services/redis';
import type { SteerQueueScope } from '@/server/services/redis/steerQueue';
import { SteerQueueWriteUnknownError } from '@/server/services/redis/steerQueue';

import { ChannelService } from './ChannelService';
import { assertChannelEnabled } from './featureGate';

const log = debug('lobe-server:channel-thread');

/** Characters of a Thread title, posted as its root on the main timeline. */
const TITLE_LENGTH = 200;
/** Threads one watch reports on; more is a dashboard, not a report. */
const MAX_WATCHED_THREADS = 10;
const DEFAULT_REPORTS = 12;
const MAX_REPORTS = 48;
const MAX_INTERVAL_MINUTES = 120;
const ROOT_EXCERPT = 80;

export const CHANNEL_WATCH_REPORT_ENDPOINT = '/api/agent/channel/watch-report';

/** Everything a scheduled report needs; it runs with no live operation behind it. */
export interface ChannelWatchReportPayload {
  agent: { agentId: string; memberId: string; name: string };
  channelId: string;
  intervalMinutes: number;
  maxReports: number;
  /** The run that started the watch, recorded as the relaying Agent's operation. */
  operationId: string;
  prompt?: string;
  /** 1-based number of the report this delivery posts. */
  report: number;
  threadIds: string[];
  userId: string;
  watchId: string;
  workspaceId?: string;
}

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
const mentionsName = (content: string, name: string) =>
  new RegExp(`@${escapeRegExp(name)}(?=$|[\\s\\p{P}\\p{S}])`, 'u').test(content);
const addressed = (content: string, name: string) =>
  mentionsName(content, name) ? content : `@${name} ${content}`;

const bounded = (
  value: string | undefined,
  what: string,
  max: number = CHANNEL_LIMITS.contentLength,
) => {
  const text = value?.trim();
  if (!text || text.length > max)
    throw new ChannelError('BAD_REQUEST', `${what} must be between 1 and ${max} characters`);
  return text;
};

const integer = (value: number | undefined, fallback: number, min: number, max: number) => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new ChannelError('BAD_REQUEST', `Expected an integer between ${min} and ${max}`);
  return result;
};

/**
 * A UUID of one tool call, stable across that call's retries. Version 8 (custom, RFC 9562) with the
 * RFC 4122 variant: the digests are not random, and `z.uuid()` rejects an id whose version or
 * variant nibble is unset — every watch report would be refused instead of posted.
 */
const keyedUuid = (namespace: string, operationId: string, requestId: string) => {
  const hex = createHash('sha256').update(`${namespace}:${operationId}:${requestId}`).digest('hex');
  const variant = '89ab'.charAt(Number.parseInt(hex.slice(16, 17), 16) & 0b11);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/**
 * The steer entry id of one tool call, UUID-shaped: a retried call appends the same entry, which
 * the steer queue recognizes instead of delivering the correction twice.
 */
export const steerEntryId = (operationId: string, requestId: string) =>
  keyedUuid('channel-steer', operationId, requestId);

/**
 * The watch of one tool call, UUID-shaped: a retried call re-derives the same watch, so the report
 * it schedules carries the same deduplication id instead of starting a second chain.
 */
export const channelWatchId = (operationId: string, requestId: string) =>
  keyedUuid('channel-watch', operationId, requestId);

const scheduleReport = async (payload: ChannelWatchReportPayload) => {
  const baseURL = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';
  await new QueueService().scheduleMessage({
    // One delivery per report, however often the previous one is retried.
    deduplicationId: `channel-watch:${payload.watchId}:${payload.report}`,
    delay: payload.intervalMinutes * 60_000,
    endpoint: new URL(CHANNEL_WATCH_REPORT_ENDPOINT, baseURL).toString(),
    operationId: `channel-watch:${payload.watchId}`,
    payload,
    retries: 3,
    stepIndex: payload.report,
  });
};

/**
 * Lets an Agent answering in a Channel work with its own replies in the Channel's other
 * Threads: see what runs where, open a Thread for a new piece of work, stop or steer one, and
 * have its progress reported on a schedule. The requester stays the sender and execution
 * identity of everything posted; `metadata.via` records the Agent that posted it.
 *
 * A run whose request an Agent posted (a Thread an Agent opened, a scheduled report) only reads:
 * it cannot open Threads or start watches, so Agents cannot fan out on their own.
 */
export class ChannelThreadService {
  private readonly history: ChannelHistoryRepository;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly operationId: string,
    private readonly workspaceId?: string,
  ) {
    this.history = new ChannelHistoryRepository(db, userId, workspaceId);
  }

  listThreads = async (params: ChannelListThreadsParams = {}): Promise<ChannelThreadPage> => {
    await assertChannelEnabled(this.userId);
    return this.history.listThreads(this.operationId, params);
  };

  /**
   * Posts the title as a root on the main timeline (waking nobody), then the request in its new
   * Thread @mentioning the Agent. `requestId` keys both posts, so a retry returns the same Thread.
   */
  createThread = async (
    params: ChannelCreateThreadParams,
    requestId: string,
  ): Promise<ChannelCreatedThread> => {
    await assertChannelEnabled(this.userId);
    const run = await this.originatingRun();
    const title = bounded(params.title, 'title', TITLE_LENGTH);
    const content = bounded(params.content, 'content');
    const agentId = params.agentId ?? run.manifest.self.agentId;
    const [member] = await this.db
      .select({ id: channelMembers.id, name: channelMembers.name })
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, run.channelId),
          eq(channelMembers.agentId, agentId),
          eq(channelMembers.actorType, 'agent'),
          eq(channelMembers.status, 'active'),
        ),
      )
      .limit(1);
    if (!member)
      throw new ChannelError('BAD_REQUEST', `Agent ${agentId} is not an Agent member here`);
    const name =
      member.id === run.manifest.self.memberId ? run.manifest.self.name : (member.name ?? 'Agent');

    const service = new ChannelService(this.db, this.userId, this.workspaceId);
    const via = this.via(run.manifest.self);
    const root = await service.send(run.channelId, {
      content: title,
      metadata: { via },
      requestKey: `agent-thread-root:${this.operationId}:${requestId}`,
      silent: true,
    });
    const message = await service.send(run.channelId, {
      content: addressed(content, name),
      mentions: [member.id],
      metadata: { via },
      requestKey: `agent-thread:${this.operationId}:${requestId}`,
      rootMessageId: root.id,
    });
    if (!message.threadId) throw new ChannelError('CONFLICT', 'The Thread could not be opened');

    return { agent: { agentId, name }, messageId: message.id, threadId: message.threadId, title };
  };

  /** Stops the requester's replies in the Thread (an admin's: every reply there). */
  stopThread = async (params: ChannelStopThreadParams): Promise<ChannelStoppedThread> => {
    await assertChannelEnabled(this.userId);
    const target = await this.history.threadTarget(this.operationId, params.threadId);
    await new ChannelService(this.db, this.userId, this.workspaceId).stop(target.channelId, {
      threadId: target.threadId,
    });
    log('[%s] Stopped Thread %s: %s', this.operationId, target.threadId, params.reason ?? '');
    return { stopped: target.openJobs.length, threadId: target.threadId };
  };

  /**
   * Joins a correction into the Agent's running reply in the Thread at its next step, and posts
   * it there for the record. When nothing of the requester's runs there (or it runs on a
   * runtime that cannot take it), the correction is posted as a new request in the Thread.
   */
  steerThread = async (
    params: ChannelSteerThreadParams,
    requestId: string,
  ): Promise<ChannelSteeredThread> => {
    await assertChannelEnabled(this.userId);
    const content = bounded(params.content, 'content');
    const target = await this.history.threadTarget(this.operationId, params.threadId);
    const service = new ChannelService(this.db, this.userId, this.workspaceId);
    const via = this.via(target.self);
    const requestKey = `agent-steer:${this.operationId}:${requestId}`;

    const running = target.openJobs.find(
      (job) =>
        job.status === 'running' &&
        job.operationStatus === 'running' &&
        job.operationUserId === this.userId &&
        job.executionConfig?.runtime === 'native' &&
        !!job.operationId &&
        !!job.topicId,
    );
    // The run's own steer queue, as a person's follow-up typed behind it. In Queue mode the run
    // would hold it for a hand-back outside the Channel, so the correction is posted instead.
    if (running && (await readFollowUpMode(this.db, this.userId)) !== 'queue') {
      const outcome = await this.queueSteer(running.operationId!, {
        entry: {
          createdAt: Date.now(),
          id: steerEntryId(this.operationId, requestId),
          request: {
            agentId: target.self.agentId,
            appContext: { topicId: running.topicId! },
            prompt: `Correction from the main conversation of this Channel, sent by you (${target.self.name}) for your requester. Follow it from now on:\n\n${content}`,
          },
          userId: this.userId,
        },
        scope: { threadId: null, topicId: running.topicId!, userId: this.userId },
      });
      if (outcome === 'queued') {
        const record = await service.send(target.channelId, {
          content,
          metadata: { steer: true, via },
          requestKey,
          silent: true,
          threadId: target.threadId,
        });
        return { delivery: 'steered', messageId: record.id, threadId: target.threadId };
      }
      if (outcome === 'unknown')
        throw new ChannelError(
          'CONFLICT',
          'The correction may already have reached the running reply; check the Thread with readMessages before sending it again',
        );
    }

    const message = await service.send(target.channelId, {
      content: addressed(content, target.self.name),
      mentions: [target.self.memberId],
      metadata: { via },
      requestKey,
      threadId: target.threadId,
    });
    return { delivery: 'queued', messageId: message.id, threadId: target.threadId };
  };

  /**
   * Appends a correction to a running reply's steer queue, which the run reads at its next step.
   * A run that ended meanwhile has its entry taken back (`ended`), so the caller posts it instead
   * of leaving it to start a turn outside the Channel. The entry id makes a retry append once.
   */
  private queueSteer = async (
    operationId: string,
    { entry, scope }: { entry: QueuedFollowUp; scope: SteerQueueScope },
  ): Promise<'ended' | 'queued' | 'unavailable' | 'unknown'> => {
    const appendOnce = () =>
      redisService.steerQueue.append(scope, entry, operationId).catch((error) => {
        if (!(error instanceof SteerQueueWriteUnknownError)) throw error;
        return 'unknown' as const;
      });

    let length = await appendOnce();
    const uncertain = length === 'unknown';
    if (uncertain) length = await appendOnce();
    if (length === 'unknown') return 'unknown';
    if (length === 'taken') return 'queued';
    if (length === undefined || length === 'notStored' || length === 'full')
      return uncertain && length === undefined ? 'unknown' : 'unavailable';

    try {
      const alive = await isRunAlive(
        { db: this.db, workspaceId: this.workspaceId },
        this.userId,
        operationId,
      );
      if (!alive && (await redisService.steerQueue.remove(scope, entry.id))) return 'ended';
    } catch (error) {
      log('[%s] Checking the steer after queuing failed: %O', operationId, error);
      return 'unknown';
    }
    return 'queued';
  };

  /**
   * Schedules the first report; each report schedules the next until the watch ends. The watch is
   * keyed by the tool call, so a retry re-schedules the same watch rather than a second one.
   */
  watchThreads = async (
    params: ChannelWatchThreadsParams,
    requestId: string,
  ): Promise<ChannelWatchedThreads> => {
    await assertChannelEnabled(this.userId);
    if (new QueueService().isLocalExecution())
      throw new ChannelError(
        'BAD_REQUEST',
        'Scheduled reports need the queue runtime, which this deployment does not run',
      );
    const run = await this.originatingRun();
    const threadIds = [...new Set(params.threadIds ?? [])];
    if (!threadIds.length || threadIds.length > MAX_WATCHED_THREADS)
      throw new ChannelError(
        'BAD_REQUEST',
        `Watch between 1 and ${MAX_WATCHED_THREADS} Threads; find them with listThreads`,
      );
    for (const threadId of threadIds) await this.history.threadTarget(this.operationId, threadId);
    const intervalMinutes = integer(params.intervalMinutes, 0, 1, MAX_INTERVAL_MINUTES);
    const maxReports = integer(params.maxReports, DEFAULT_REPORTS, 1, MAX_REPORTS);
    const prompt = params.prompt?.trim()
      ? bounded(params.prompt, 'prompt', CHANNEL_LIMITS.contentLength / 10)
      : undefined;

    const watchId = channelWatchId(this.operationId, requestId);
    await scheduleReport({
      agent: {
        agentId: run.manifest.self.agentId,
        memberId: run.manifest.self.memberId,
        name: run.manifest.self.name,
      },
      channelId: run.channelId,
      intervalMinutes,
      maxReports,
      operationId: this.operationId,
      ...(prompt && { prompt }),
      report: 1,
      threadIds,
      userId: this.userId,
      watchId,
      workspaceId: this.workspaceId,
    });
    return { intervalMinutes, maxReports, threadIds, watchId };
  };

  unwatchThreads = async (params: ChannelUnwatchThreadsParams): Promise<{ watchId: string }> => {
    await assertChannelEnabled(this.userId);
    await this.history.currentRun(this.operationId);
    const watchId = params.watchId?.trim();
    if (!watchId) throw new ChannelError('BAD_REQUEST', 'watchId is required');
    if (!(await redisService.channelWatch.stop(watchId)))
      throw new ChannelError('CONFLICT', 'The watch could not be stopped; try again shortly');
    return { watchId };
  };

  /** The run, refusing one whose request an Agent posted: such a run answers, it does not fan out. */
  private originatingRun = async () => {
    const run = await this.history.currentRun(this.operationId);
    if (run.requestVia || run.requestByAgent)
      throw new ChannelError(
        'FORBIDDEN',
        'An Agent posted this request; answer it here instead of opening Threads or watches',
      );
    return run;
  };

  /** `operationId` records the run that posted it, as a relay does; it is never shown. */
  private via = (self: {
    agentId: string;
    name: string;
  }): ChannelMessageVia & { operationId: string } => ({
    agentId: self.agentId,
    name: self.name,
    operationId: this.operationId,
  });
}

/**
 * Posts one scheduled report request on the main timeline, as the requester @mentioning the
 * Agent, and schedules the next. The watch ends when it was stopped, when it posted its last
 * report, or when none of the Agent's watched replies still runs (that report asks for a
 * summary). A requester who lost access ends it too: posting fails the Channel's own checks.
 */
export const runChannelWatchReport = async (
  db: LobeChatDatabase,
  payload: ChannelWatchReportPayload,
): Promise<'ended' | 'reported' | 'stopped'> => {
  if (await redisService.channelWatch.isStopped(payload.watchId)) return 'stopped';

  const open = await db
    .selectDistinct({ threadId: channelJobs.threadId })
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.channelId, payload.channelId),
        eq(channelJobs.memberId, payload.agent.memberId),
        inArray(channelJobs.threadId, payload.threadIds),
        inArray(channelJobs.status, ['queued', 'running']),
      ),
    );
  const roots = await db
    .select({ content: channelMessages.content, threadId: channelThreads.id })
    .from(channelThreads)
    .innerJoin(
      channelMessages,
      and(
        eq(channelMessages.channelId, channelThreads.channelId),
        eq(channelMessages.id, channelThreads.rootMessageId),
      ),
    )
    .where(
      and(
        eq(channelThreads.channelId, payload.channelId),
        inArray(channelThreads.id, payload.threadIds),
      ),
    );
  const done = open.length === 0;
  const last = done || payload.report >= payload.maxReports;
  const running = new Set(open.map((row) => row.threadId));
  const list = roots
    .map(({ content, threadId }) => {
      const title = content.trim().replaceAll(/\s+/g, ' ');
      const excerpt = title.length > ROOT_EXCERPT ? `${title.slice(0, ROOT_EXCERPT)}…` : title;
      return `- ${excerpt} (${running.has(threadId) ? 'running' : 'finished'})`;
    })
    .join('\n');
  const ask = done
    ? 'Every watched Thread has finished. Read them with listThreads and readMessages(threadId) and summarize the results for me.'
    : (payload.prompt ??
      'Read the latest progress of these Threads with listThreads and readMessages(threadId) and give me a short update.');
  const header = `[${last ? 'Final report' : `Report ${payload.report}/${payload.maxReports}`}]`;

  await new ChannelService(db, payload.userId, payload.workspaceId).send(payload.channelId, {
    content: `@${payload.agent.name} ${header} ${ask}\n${list}`,
    mentions: [payload.agent.memberId],
    metadata: {
      via: {
        agentId: payload.agent.agentId,
        name: payload.agent.name,
        operationId: payload.operationId,
      },
    },
    requestKey: `channel-watch:${payload.watchId}:${payload.report}`,
  });
  if (last) return 'ended';

  await scheduleReport({ ...payload, report: payload.report + 1 });
  return 'reported';
};
