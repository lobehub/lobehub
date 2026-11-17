import { randomUUID } from 'node:crypto';

import { generateWorktreeBranchName } from '@lobechat/const';
import type {
  ChatTopicMetadata,
  ChatTopicStatus,
  ExecAgentResult,
  UserInterventionConfig,
  WorkingDirConfig,
} from '@lobechat/types';

import type { OpenedTopicItem } from '@/database/models/topic';

/**
 * Sub-sessions: a real topic another topic opened, linked by
 * `metadata.openedBy` (see `TopicOpenedBy`). Everything an agent (the
 * `lobe-session` tool, `lh session …`) or the sidebar does to them goes through
 * here, on top of the same entries the rest of the app uses — `execAgent` to
 * start, the steer queue to follow up, `updateTopic` to archive, the trash
 * service to delete — so whatever those entries do (worktree cleanup on
 * archive, follow-up Queue/Steer) applies to sub-sessions too.
 */

export type SubSessionWorkspace = 'inherit' | 'new-worktree' | 'none';

export const SUB_SESSION_TRIGGER = 'sub_session';

/** Statuses that take a topic out of the sidebar (archive writes `completed`). */
export const RETIRED_TOPIC_STATUSES: ChatTopicStatus[] = ['completed', 'archived'];

export type SubSessionState = 'archived' | 'failed' | 'idle' | 'running' | 'waiting_for_user';

export const toSubSessionState = (status: ChatTopicStatus | null | undefined): SubSessionState => {
  switch (status) {
    case 'running': {
      return 'running';
    }
    case 'waitingForHuman': {
      return 'waiting_for_user';
    }
    case 'failed': {
      return 'failed';
    }
    case 'completed':
    case 'archived': {
      return 'archived';
    }
    default: {
      return 'idle';
    }
  }
};

interface TopicRow {
  agentId?: null | string;
  id: string;
  metadata?: ChatTopicMetadata | null;
  status?: ChatTopicStatus | null;
  title?: null | string;
  trigger?: null | string;
}

export interface SubSessionDeps {
  addGitWorktree: (params: {
    branch: string;
    deviceId: string;
    path: string;
    sourcePath?: string;
    startPoint?: string;
  }) => Promise<{ error?: string; success: boolean; worktreePath?: string }>;
  /** Append a follow-up behind a live run; `idle` when nothing is running. */
  appendFollowUp: (params: {
    id: string;
    request: Record<string, unknown>;
  }) => Promise<{ queued: boolean; reason?: string }>;
  archiveTopic: (topicId: string) => Promise<unknown>;
  detachTopics: (
    topicIds: string[],
  ) => Promise<{ agentId: null | string; id: string; trigger: null | string }[]>;
  execAgent: (params: Record<string, unknown>) => Promise<ExecAgentResult>;
  findLiveRunIds: (topicId: string) => Promise<string[]>;
  findTopic: (topicId: string) => Promise<TopicRow | null | undefined>;
  interrupt: (operationId: string) => Promise<unknown>;
  listDescendants: (topicId: string) => Promise<OpenedTopicItem[]>;
  listOpened: (openerTopicIds: string[]) => Promise<OpenedTopicItem[]>;
  readLastReply: (topicId: string) => Promise<string | undefined>;
  resolveInterventionConfig: () => Promise<UserInterventionConfig>;
  /** Start a turn on an existing topic without taking it over from a live run. */
  startOnTopic: (params: Record<string, unknown>) => Promise<ExecAgentResult>;
  trashTopic: (topicId: string) => Promise<unknown>;
}

export class SubSessionError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'SubSessionError';
  }
}

export interface StartSubSessionInput {
  /** Target agent; defaults to the opener's own agent. */
  agentId?: string;
  /** Branch the new worktree forks from (`workspace: 'new-worktree'`); HEAD otherwise. */
  baseBranch?: string;
  deviceId?: string;
  openerTopicId: string;
  prompt: string;
  /** The run that opens it, for authorship and the relay hop. */
  sourceOperationId?: string;
  title?: string;
  workspace?: SubSessionWorkspace;
}

/** The opener's directory, shared rather than owned: the child must never clean it up. */
const inheritWorkingDirectory = (metadata: ChatTopicMetadata | null | undefined) => {
  const config = metadata?.workingDirectoryConfig;
  const workingDirectory =
    metadata?.workingDirectory ?? config?.git?.activeWorktree ?? config?.path;
  if (!workingDirectory && !config) return;

  const shared: WorkingDirConfig | undefined = config
    ? {
        ...config,
        ...(config.git && {
          git: { ...config.git, autoCreated: undefined, autoCreatedAt: undefined },
        }),
      }
    : undefined;
  return {
    ...(workingDirectory && { workingDirectory }),
    ...(shared && { workingDirectoryConfig: shared }),
  };
};

/**
 * The descendants an "archive / delete all" takes along: everything except
 * task runs and whatever they opened. A task run belongs to its task, which
 * keeps running it and reads its topic; retiring a conversation must not stop
 * or remove it.
 */
export const retirableDescendants = (rootId: string, descendants: OpenedTopicItem[]) => {
  const kept = new Set<string>([rootId]);
  const result: OpenedTopicItem[] = [];
  let pending = descendants;
  // Parents usually arrive before children (breadth-first walk); repeat until nothing moves.
  while (pending.length > 0) {
    const next: OpenedTopicItem[] = [];
    for (const item of pending) {
      const parent = item.openedBy?.topicId;
      if (!parent || !kept.has(parent)) {
        next.push(item);
        continue;
      }
      if (item.trigger === 'task') continue;
      kept.add(item.id);
      result.push(item);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  return result;
};

export class SubSessionService {
  constructor(private readonly deps: SubSessionDeps) {}

  private async requireTopic(topicId: string): Promise<TopicRow> {
    const topic = await this.deps.findTopic(topicId);
    if (!topic) throw new SubSessionError('NOT_FOUND', `Topic ${topicId} not found.`);
    return topic;
  }

  /** Open a sub-session and send its first message; returns as soon as the run is dispatched. */
  async start(input: StartSubSessionInput) {
    const opener = await this.requireTopic(input.openerTopicId);
    const agentId = input.agentId || opener.agentId;
    if (!agentId) {
      throw new SubSessionError('BAD_REQUEST', 'Name the agent to open the sub-session with.');
    }

    const workspace = input.workspace ?? 'inherit';
    const deviceId = input.deviceId ?? opener.metadata?.boundDeviceId;
    let initialTopicMetadata: Record<string, unknown> | undefined;
    let branch: string | undefined;

    if (workspace === 'inherit') {
      initialTopicMetadata = inheritWorkingDirectory(opener.metadata);
    } else if (workspace === 'new-worktree') {
      const config = opener.metadata?.workingDirectoryConfig;
      const repoPath =
        config?.git?.activeWorktree ?? config?.path ?? opener.metadata?.workingDirectory;
      if (!repoPath || !deviceId) {
        throw new SubSessionError(
          'BAD_REQUEST',
          'A new worktree needs this conversation to work in a git repository on a connected device. Use workspace "inherit" or "none" instead.',
        );
      }
      branch = generateWorktreeBranchName();
      const sourcePath = config?.path ?? repoPath;
      const created = await this.deps.addGitWorktree({
        branch,
        deviceId,
        path: repoPath,
        sourcePath,
        startPoint: input.baseBranch,
      });
      if (!created.success || !created.worktreePath) {
        throw new SubSessionError(
          'BAD_REQUEST',
          `Could not create the worktree: ${created.error || 'unknown error'}`,
        );
      }
      // `autoCreated` is what claims the worktree for this topic, so it is
      // cleaned up when the topic is archived or trashed.
      initialTopicMetadata = {
        workingDirectory: created.worktreePath,
        workingDirectoryConfig: {
          git: {
            activeWorktree: created.worktreePath,
            autoCreated: true,
            autoCreatedAt: new Date().toISOString(),
            branch,
            isWorktree: true,
          },
          path: sourcePath,
          repoType: config?.repoType ?? 'git',
          sessionPath: created.worktreePath,
        },
      };
    }

    const result = await this.deps.execAgent({
      agentId,
      ...(initialTopicMetadata && { appContext: { initialTopicMetadata } }),
      // `workspace` only decides the directory: a sub-session stays on the opener's
      // device (or the one asked for) either way — a device-bound agent such as
      // Claude Code has nowhere else to run.
      ...(deviceId && { deviceId }),
      openedByTopicId: opener.id,
      prompt: input.prompt,
      ...(input.sourceOperationId && { sourceOperationId: input.sourceOperationId }),
      ...(input.title && { title: input.title }),
      trigger: SUB_SESSION_TRIGGER,
      userInterventionConfig: await this.deps.resolveInterventionConfig(),
    });
    if (!result.success || !result.topicId) {
      throw new SubSessionError(
        'BAD_REQUEST',
        `Failed to start the sub-session: ${result.error || 'unknown error'}`,
      );
    }

    return {
      agentId,
      branch,
      operationId: result.operationId,
      topicId: result.topicId,
      workingDirectory: initialTopicMetadata?.workingDirectory as string | undefined,
    };
  }

  /** The live sub-sessions `openerTopicId` opened (direct ones only). */
  async list(openerTopicId: string) {
    const rows = await this.deps.listOpened([openerTopicId]);
    return rows.map((row) => ({
      agentId: row.agentId,
      state: toSubSessionState(row.status),
      title: row.title,
      topicId: row.id,
      trigger: row.trigger,
      updatedAt: row.updatedAt,
    }));
  }

  async get(topicId: string) {
    const topic = await this.requireTopic(topicId);
    const liveRuns = await this.deps.findLiveRunIds(topicId);
    const state = liveRuns.length > 0 ? 'running' : toSubSessionState(topic.status);

    return {
      agentId: topic.agentId,
      lastReply: await this.deps.readLastReply(topicId),
      openedBy: topic.metadata?.openedBy,
      state,
      title: topic.title,
      topicId,
    };
  }

  /**
   * Send a message to a sub-session: start a turn when it is idle, otherwise
   * queue it behind the running turn, where the user's Follow-up behavior
   * (Queue / Steer) decides what happens to it. Never interrupts.
   */
  async send(params: { message: string; sourceOperationId?: string; topicId: string }) {
    const topic = await this.requireTopic(params.topicId);
    if (!topic.agentId) {
      throw new SubSessionError('BAD_REQUEST', `Topic ${topic.id} belongs to no agent.`);
    }

    const request = {
      agentId: topic.agentId,
      appContext: { topicId: topic.id },
      prompt: params.message,
      ...(params.sourceOperationId && { sourceOperationId: params.sourceOperationId }),
      trigger: SUB_SESSION_TRIGGER,
      userInterventionConfig: await this.deps.resolveInterventionConfig(),
    };
    const entryId = randomUUID();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const queued = await this.deps.appendFollowUp({ id: entryId, request });
      if (queued.queued) return { delivery: 'queued' as const, topicId: topic.id };
      if (queued.reason !== 'idle') {
        throw new SubSessionError(
          'CONFLICT',
          queued.reason === 'full'
            ? `Topic ${topic.id} already has too many messages waiting; try again after its turn ends.`
            : `Could not queue the message behind the running turn of ${topic.id}; try again.`,
        );
      }

      try {
        const started = await this.deps.startOnTopic(request);
        if (!started.success) {
          throw new SubSessionError(
            'BAD_REQUEST',
            `Failed to start ${topic.id}: ${started.error || 'unknown error'}`,
          );
        }
        return {
          delivery: 'started' as const,
          operationId: started.operationId,
          topicId: topic.id,
        };
      } catch (error) {
        // A turn began after the queue saw the topic idle: queue behind it instead.
        if ((error as { code?: string })?.code !== 'CONFLICT') throw error;
      }
    }

    throw new SubSessionError('CONFLICT', `Topic ${topic.id} kept starting new turns; try again.`);
  }

  /**
   * What archiving or trashing `topicId` would touch: its live descendants,
   * how many of them are running, and its direct sub-sessions (which move to
   * the top level when only the topic itself goes).
   */
  async describe(topicId: string) {
    await this.requireTopic(topicId);
    const descendants = retirableDescendants(topicId, await this.deps.listDescendants(topicId));
    return {
      descendants: descendants.length,
      direct: descendants.filter((item) => item.openedBy?.topicId === topicId).length,
      running: descendants.filter(
        (item) => item.status === 'running' || item.status === 'waitingForHuman',
      ).length,
      topicId,
    };
  }

  /** Stop the sub-session's current turn. No receipt is sent for a stopped turn. */
  async stop(topicId: string) {
    await this.requireTopic(topicId);
    const runIds = await this.deps.findLiveRunIds(topicId);
    for (const operationId of runIds) await this.deps.interrupt(operationId);
    return { stopped: runIds.length, topicId };
  }

  /**
   * Archive (or trash) a topic that may have sub-sessions.
   *
   * - `all`: stop every running descendant, then archive each one through the
   *   shared entry, children first, the topic last.
   * - `self`: archive the topic only; its direct sub-sessions move to the top
   *   level (`openedBy.detachedAt`), cross-agent ones back to their own agent.
   */
  async retire(params: { action: 'archive' | 'trash'; mode: 'all' | 'self'; topicId: string }) {
    const root = await this.requireTopic(params.topicId);
    const retireOne = params.action === 'archive' ? this.deps.archiveTopic : this.deps.trashTopic;

    if (params.mode === 'all') {
      const descendants = retirableDescendants(root.id, await this.deps.listDescendants(root.id));
      for (const item of descendants) {
        if (item.status === 'running' || item.status === 'waitingForHuman') {
          for (const operationId of await this.deps.findLiveRunIds(item.id)) {
            await this.deps.interrupt(operationId);
          }
        }
      }
      // Deepest first, so a failure part-way never leaves a child under a retired parent.
      for (const item of [...descendants].reverse()) await retireOne(item.id);
      await retireOne(root.id);
      return { detached: [], retired: [...descendants.map((item) => item.id), root.id] };
    }

    const children = await this.deps.listOpened([root.id]);
    const detached = await this.deps.detachTopics(children.map((child) => child.id));
    await retireOne(root.id);
    return { detached: this.describeMoves(root, detached), retired: [root.id] };
  }

  /**
   * Whether `topicId` is a sub-session (at any depth) of `openerTopicId` — the
   * only topics the `lobe-session` tool of that conversation may act on.
   */
  async isOpenedBy(topicId: string, openerTopicId: string): Promise<boolean> {
    const seen = new Set<string>();
    let cursor: string | undefined = topicId;
    for (let depth = 0; cursor && depth < 8 && !seen.has(cursor); depth += 1) {
      seen.add(cursor);
      const topic = await this.deps.findTopic(cursor);
      const openedBy = topic?.metadata?.openedBy;
      if (!openedBy?.topicId || openedBy.detachedAt) return false;
      if (openedBy.topicId === openerTopicId) return true;
      cursor = openedBy.topicId;
    }
    return false;
  }

  /** Move sub-sessions to the top level. */
  async detach(topicIds: string[]) {
    const topics = (await Promise.all(topicIds.map((id) => this.deps.findTopic(id)))).filter(
      (topic): topic is TopicRow => !!topic,
    );
    const runRows = topics.filter((topic) => topic.trigger === 'task');
    if (runRows.length > 0) {
      throw new SubSessionError(
        'BAD_REQUEST',
        'A task run belongs to its task and cannot be moved to the top level; open it from the task instead.',
      );
    }

    const openers = new Map<string, TopicRow>();
    for (const topic of topics) {
      const openerId = topic.metadata?.openedBy?.topicId;
      if (openerId && !openers.has(openerId)) {
        const opener = await this.deps.findTopic(openerId);
        if (opener) openers.set(openerId, opener);
      }
    }

    const detached = await this.deps.detachTopics(topics.map((topic) => topic.id));
    return {
      detached: detached.map((row) => {
        const topic = topics.find((item) => item.id === row.id);
        const opener = openers.get(topic?.metadata?.openedBy?.topicId ?? '');
        return { ...row, movedToOwnAgent: !!opener && opener.agentId !== row.agentId };
      }),
    };
  }

  private describeMoves(
    opener: TopicRow,
    detached: { agentId: null | string; id: string; trigger: null | string }[],
  ) {
    return detached.map((row) => ({ ...row, movedToOwnAgent: row.agentId !== opener.agentId }));
  }
}
