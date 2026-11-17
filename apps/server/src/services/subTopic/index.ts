import { randomUUID } from 'node:crypto';

import { generateWorktreeBranchName } from '@lobechat/const';
import type {
  AgentOperationStatus,
  ChatTopicMetadata,
  ChatTopicStatus,
  ExecAgentResult,
  SubTopicState,
  UserInterventionConfig,
  WorkingDirConfig,
} from '@lobechat/types';
import pMap from 'p-map';

import type { OpenedTopicItem } from '@/database/models/topic';
import { pickSandboxPlacement } from '@/server/services/aiAgent/pipeline/sandboxPlacement';

/**
 * Sub-topics: a real topic another topic opened, linked by
 * `metadata.openedBy` (see `TopicOpenedBy`). Everything an agent (the
 * `lobe-topic` tool, `lh topic …`) or the sidebar does to them goes through
 * here, on top of the same entries the rest of the app uses — `execAgent` to
 * start, the steer queue to follow up, `updateTopic` to archive, the trash
 * service to delete — so whatever those entries do (worktree cleanup on
 * archive, follow-up Queue/Steer) applies to sub-topics too.
 */

export type SubTopicWorkspace = 'inherit' | 'new-worktree' | 'none';

export const SUB_TOPIC_TRIGGER = 'sub_topic';

/** Concurrent topic reads behind one "move to top level" request. */
const FIND_TOPIC_CONCURRENCY = 5;

/** Statuses that take a topic out of the sidebar (archive writes `completed`). */
export const RETIRED_TOPIC_STATUSES: ChatTopicStatus[] = ['completed', 'archived'];

export type { SubTopicState } from '@lobechat/types';

/**
 * What a sub-topic is doing. The latest top-level operation wins while it is
 * in flight or failed — a server-run turn never writes `topics.status` — and
 * the topic's own status (archive, a client run) decides otherwise.
 */
export const toSubTopicState = (
  status: ChatTopicStatus | null | undefined,
  latestRunStatus?: AgentOperationStatus | null,
): SubTopicState => {
  if (status === 'completed' || status === 'archived') return 'archived';
  switch (latestRunStatus) {
    case 'waiting_for_human': {
      return 'waiting_for_user';
    }
    case 'idle':
    case 'running':
    case 'waiting_for_async_tool':
    case 'waiting_for_client': {
      return 'running';
    }
    case 'error': {
      return 'failed';
    }
  }
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

export interface SubTopicDeps {
  addGitWorktree: (params: {
    branch: string;
    deviceId: string;
    path: string;
    ownerToken?: string;
    sourcePath?: string;
    startPoint?: string;
  }) => Promise<{
    error?: string;
    /** The creation receipt the device recorded, echoed back. */
    ownerToken?: string;
    success: boolean;
    worktreePath?: string;
  }>;
  /** Append a follow-up behind a live run; `idle` when nothing is running. */
  appendFollowUp: (params: {
    id: string;
    request: Record<string, unknown>;
  }) => Promise<{ queued: boolean; reason?: string }>;
  archiveTopic: (topicId: string) => Promise<unknown>;
  /**
   * Throws unless the caller may edit these topics (`use` on their agent) —
   * what `topic.updateTopic` checks, so view-only members stay read-only.
   */
  assertCanEditTopics: (topicIds: string[]) => Promise<void>;
  /**
   * Throws unless the caller may run `agentId` in a conversation opened from
   * `openerTopicId` — the same workspace checks `aiAgent.execAgent` applies.
   */
  assertCanOpen: (params: { agentId: string; openerTopicId: string }) => Promise<void>;
  detachTopics: (
    topicIds: string[],
  ) => Promise<{ agentId: null | string; id: string; trigger: null | string }[]>;
  execAgent: (params: Record<string, unknown>) => Promise<ExecAgentResult>;
  /** Status of the topic's latest top-level operation; null before its first run. */
  findLatestRunStatus: (topicId: string) => Promise<AgentOperationStatus | null>;
  findLiveRunIds: (topicId: string) => Promise<string[]>;
  findTopic: (topicId: string) => Promise<TopicRow | null | undefined>;
  interrupt: (operationId: string) => Promise<unknown>;
  /** A server-signed creation receipt for a worktree about to be made; none without a server secret. */
  issueWorktreeReceipt: () => { nonce: string; token: string } | undefined;
  listDescendants: (topicId: string) => Promise<OpenedTopicItem[]>;
  listOpened: (openerTopicIds: string[]) => Promise<OpenedTopicItem[]>;
  readLastReply: (topicId: string) => Promise<string | undefined>;
  resolveInterventionConfig: () => Promise<UserInterventionConfig>;
  /**
   * Undo a worktree `open` created when the run it was for never started a
   * topic: remove the folder and its fresh branch unless some topic already
   * points at it. Best effort; never throws.
   */
  rollbackWorktree: (params: {
    branch: string;
    deviceId: string;
    repoPath: string;
    worktreePath: string;
  }) => Promise<void>;
  /** Start a turn on an existing topic without taking it over from a live run. */
  startOnTopic: (params: Record<string, unknown>) => Promise<ExecAgentResult>;
  /** `removeFiles`: also delete uploads only this topic references (the delete confirm's checkbox). */
  trashTopic: (topicId: string, options: { removeFiles: boolean }) => Promise<unknown>;
}

export class SubTopicError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'CONFLICT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'SubTopicError';
  }
}

export interface OpenSubTopicInput {
  /** Target agent; defaults to the opener's own agent. */
  agentId?: string;
  /** Branch the new worktree forks from (`workspace: 'new-worktree'`); HEAD otherwise. */
  baseBranch?: string;
  /**
   * Open a plain topic instead: no `openedBy` link, no `sub_topic` trigger, no
   * receipts — it is not listed under the parent and never reports back.
   */
  detach?: boolean;
  deviceId?: string;
  openerTopicId: string;
  prompt: string;
  /** The run that opens it, for authorship and the relay hop. */
  sourceOperationId?: string;
  title?: string;
  workspace?: SubTopicWorkspace;
}

/**
 * The opener's place to work, shared rather than owned: its device directory
 * (without the claims that make a cleanup or a PR lookup treat it as the
 * child's own) and its cloud-sandbox placement, so the child sees the same
 * files whichever side the opener runs on.
 */
const inheritWorkingDirectory = (metadata: ChatTopicMetadata | null | undefined) => {
  const config = metadata?.workingDirectoryConfig;
  const workingDirectory =
    metadata?.workingDirectory ?? config?.git?.activeWorktree ?? config?.path;
  const sandbox = pickSandboxPlacement(metadata ?? undefined);

  let shared: WorkingDirConfig | undefined;
  if (config) {
    shared = { ...config };
    if (config.git) {
      const git = { ...config.git };
      // The opener created that worktree / branch; the child must never clean
      // it up, and it is not the child's branch to find a PR for.
      delete git.autoCreated;
      delete git.autoCreatedAt;
      delete git.ownBranch;
      delete git.ownerNonce;
      delete git.ownerToken;
      shared.git = git;
    }
  }
  if (!workingDirectory && !shared && Object.keys(sandbox).length === 0) return;
  return {
    ...sandbox,
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

export class SubTopicService {
  constructor(private readonly deps: SubTopicDeps) {}

  private async requireTopic(topicId: string): Promise<TopicRow> {
    const topic = await this.deps.findTopic(topicId);
    if (!topic) throw new SubTopicError('NOT_FOUND', `Topic ${topicId} not found.`);
    return topic;
  }

  /** Open a sub-topic and send its first message; returns as soon as the run is dispatched. */
  async open(input: OpenSubTopicInput) {
    const opener = await this.requireTopic(input.openerTopicId);
    const agentId = input.agentId || opener.agentId;
    if (!agentId) {
      throw new SubTopicError('BAD_REQUEST', 'Name the agent to open the sub-topic with.');
    }
    await this.deps.assertCanOpen({ agentId, openerTopicId: opener.id });

    const workspace = input.workspace ?? 'inherit';
    const deviceId = input.deviceId ?? opener.metadata?.boundDeviceId;
    let initialTopicMetadata: Record<string, unknown> | undefined;
    let branch: string | undefined;
    /** The worktree made for this sub-topic, until a topic records it. */
    let createdWorktree: { repoPath: string; worktreePath: string } | undefined;

    if (workspace === 'inherit') {
      initialTopicMetadata = inheritWorkingDirectory(opener.metadata);
    } else if (workspace === 'new-worktree') {
      const config = opener.metadata?.workingDirectoryConfig;
      const repoPath =
        config?.git?.activeWorktree ?? config?.path ?? opener.metadata?.workingDirectory;
      if (!repoPath || !deviceId) {
        throw new SubTopicError(
          'BAD_REQUEST',
          'A new worktree needs this conversation to work in a git repository on a connected device. Use workspace "inherit" or "none" instead.',
        );
      }
      branch = generateWorktreeBranchName();
      const sourcePath = config?.path ?? repoPath;
      // The creation receipt, signed for this user: the device writes it into
      // the worktree, and only a cleanup presenting it may later force-remove
      // the folder (e.g. "discard changes and delete" on a kept dirty one).
      const receipt = this.deps.issueWorktreeReceipt();
      const created = await this.deps.addGitWorktree({
        branch,
        deviceId,
        ...(receipt && { ownerToken: receipt.token }),
        path: repoPath,
        sourcePath,
        startPoint: input.baseBranch,
      });
      if (!created.success || !created.worktreePath) {
        throw new SubTopicError(
          'BAD_REQUEST',
          `Could not create the worktree: ${created.error || 'unknown error'}`,
        );
      }
      createdWorktree = { repoPath, worktreePath: created.worktreePath };
      // `autoCreated` is what claims the worktree for this topic, so it is
      // cleaned up when the topic is archived or trashed.
      initialTopicMetadata = {
        workingDirectory: created.worktreePath,
        workingDirectoryConfig: {
          git: {
            activeWorktree: created.worktreePath,
            autoCreated: true,
            autoCreatedAt: new Date().toISOString(),
            // Only what the device confirms it recorded.
            ...(receipt &&
              created.ownerToken === receipt.token && {
                ownerNonce: receipt.nonce,
                ownerToken: receipt.token,
              }),
            branch,
            isWorktree: true,
            // This sub-topic created the branch: its run end may look its PR up.
            ownBranch: branch,
          },
          path: sourcePath,
          repoType: config?.repoType ?? 'git',
          sessionPath: created.worktreePath,
        },
      };
    }

    // A worktree made for this run is the run's only owner until a topic
    // records it; if dispatch is refused before that, nothing would ever
    // clean it up, so take it back here.
    const rollback = async () => {
      if (!createdWorktree || !branch || !deviceId) return;
      await this.deps.rollbackWorktree({ branch, deviceId, ...createdWorktree });
    };

    let result: ExecAgentResult;
    try {
      result = await this.deps.execAgent({
        agentId,
        ...(initialTopicMetadata && { appContext: { initialTopicMetadata } }),
        // `workspace` only decides the directory: a sub-topic stays on the opener's
        // device (or the one asked for) either way — a device-bound agent such as
        // Claude Code has nowhere else to run.
        ...(deviceId && { deviceId }),
        // A device asked for by name must be the one it runs on: fail rather than
        // fall back to the cloud when it is offline.
        ...(input.deviceId && { requireDevice: true }),
        ...(!input.detach && { openedByTopicId: opener.id }),
        prompt: input.prompt,
        ...(input.sourceOperationId && { sourceOperationId: input.sourceOperationId }),
        ...(input.title && { title: input.title }),
        ...(!input.detach && { trigger: SUB_TOPIC_TRIGGER }),
        userInterventionConfig: await this.deps.resolveInterventionConfig(),
      });
    } catch (error) {
      await rollback();
      throw error;
    }
    if (!result.success || !result.topicId) {
      if (!result.topicId) await rollback();
      throw new SubTopicError(
        'BAD_REQUEST',
        `Failed to start the sub-topic: ${result.error || 'unknown error'}`,
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

  /** The live sub-topics `openerTopicId` opened (direct ones only). */
  async list(openerTopicId: string) {
    const rows = await this.deps.listOpened([openerTopicId]);
    return rows.map((row) => ({
      agentId: row.agentId,
      state: toSubTopicState(row.status, row.latestRunStatus),
      title: row.title,
      topicId: row.id,
      trigger: row.trigger,
      updatedAt: row.updatedAt,
    }));
  }

  async get(topicId: string) {
    const topic = await this.requireTopic(topicId);
    const [liveRuns, latestRunStatus] = await Promise.all([
      this.deps.findLiveRunIds(topicId),
      this.deps.findLatestRunStatus(topicId),
    ]);
    // Same reading as the lists: the latest run says running / waiting / failed;
    // a live run that has not written its status yet still counts as running.
    const fromRun = toSubTopicState(topic.status, latestRunStatus);
    const state = fromRun === 'idle' && liveRuns.length > 0 ? 'running' : fromRun;

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
   * Send a message to a sub-topic: start a turn when it is idle, otherwise
   * queue it behind the running turn, where the user's Follow-up behavior
   * (Queue / Steer) decides what happens to it. Never interrupts.
   */
  async send(params: { message: string; sourceOperationId?: string; topicId: string }) {
    const topic = await this.requireTopic(params.topicId);
    if (!topic.agentId) {
      throw new SubTopicError('BAD_REQUEST', `Topic ${topic.id} belongs to no agent.`);
    }

    const request = {
      agentId: topic.agentId,
      appContext: { topicId: topic.id },
      prompt: params.message,
      ...(params.sourceOperationId && { sourceOperationId: params.sourceOperationId }),
      trigger: SUB_TOPIC_TRIGGER,
      userInterventionConfig: await this.deps.resolveInterventionConfig(),
    };
    const entryId = randomUUID();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const queued = await this.deps.appendFollowUp({ id: entryId, request });
      if (queued.queued) return { delivery: 'queued' as const, topicId: topic.id };
      if (queued.reason !== 'idle') {
        throw new SubTopicError(
          'CONFLICT',
          queued.reason === 'full'
            ? `Topic ${topic.id} already has too many messages waiting; try again after its turn ends.`
            : `Could not queue the message behind the running turn of ${topic.id}; try again.`,
        );
      }

      try {
        const started = await this.deps.startOnTopic(request);
        if (!started.success) {
          throw new SubTopicError(
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
        const conflict =
          (error as { code?: string })?.code === 'CONFLICT' ||
          (error as Error)?.name === 'TopicStartReservationError';
        if (!conflict) throw error;
      }
    }

    throw new SubTopicError('CONFLICT', `Topic ${topic.id} kept starting new turns; try again.`);
  }

  /**
   * What archiving or trashing `topicId` would touch: its live descendants,
   * how many of them are running, and its direct sub-topics (which move to
   * the top level when only the topic itself goes).
   */
  async describe(topicId: string) {
    await this.requireTopic(topicId);
    const descendants = retirableDescendants(topicId, await this.deps.listDescendants(topicId));
    return {
      descendants: descendants.length,
      direct: descendants.filter((item) => item.openedBy?.topicId === topicId).length,
      running: descendants.filter((item) => {
        const state = toSubTopicState(item.status, item.latestRunStatus);
        return state === 'running' || state === 'waiting_for_user';
      }).length,
      topicId,
    };
  }

  /** Stop the sub-topic's current turn. No receipt is sent for a stopped turn. */
  async stop(topicId: string) {
    await this.requireTopic(topicId);
    const runIds = await this.deps.findLiveRunIds(topicId);
    for (const operationId of runIds) await this.deps.interrupt(operationId);
    return { stopped: runIds.length, topicId };
  }

  /**
   * Archive (or trash) a topic that may have sub-topics.
   *
   * - `all`: stop every running descendant, then archive each one through the
   *   shared entry, children first, the topic last.
   * - `self`: archive the topic only; its direct sub-topics move to the top
   *   level (`openedBy.detachedAt`), cross-agent ones back to their own agent.
   */
  async retire(params: {
    action: 'archive' | 'trash';
    mode: 'all' | 'self';
    /** Trash only: also delete the topics' uploads, as the delete confirm offers. Defaults to yes. */
    removeFiles?: boolean;
    topicId: string;
  }) {
    const root = await this.requireTopic(params.topicId);
    const removeFiles = params.removeFiles ?? true;
    const retireOne =
      params.action === 'archive'
        ? (topicId: string) => this.deps.archiveTopic(topicId)
        : (topicId: string) => this.deps.trashTopic(topicId, { removeFiles });

    if (params.mode === 'all') {
      const descendants = retirableDescendants(root.id, await this.deps.listDescendants(root.id));
      // Ask each one for its live runs rather than trusting a status field: a
      // server-run turn never writes `topics.status`.
      for (const item of descendants) {
        for (const operationId of await this.deps.findLiveRunIds(item.id)) {
          await this.deps.interrupt(operationId);
        }
      }
      // Deepest first, so a failure part-way never leaves a child under a retired parent.
      for (const item of [...descendants].reverse()) await retireOne(item.id);
      await retireOne(root.id);
      return { detached: [], retired: [...descendants.map((item) => item.id), root.id] };
    }

    const children = await this.deps.listOpened([root.id]);
    const detached = await this.detachChecked(children.map((child) => child.id));
    await retireOne(root.id);
    return { detached: this.describeMoves(root, detached), retired: [root.id] };
  }

  /**
   * Whether `topicId` is a sub-topic (at any depth) of `openerTopicId` — the
   * only topics the `lobe-topic` tool of that conversation may act on.
   */
  async isOpenedBy(topicId: string, openerTopicId: string): Promise<boolean> {
    const seen = new Set<string>();
    let cursor: string | undefined = topicId;
    // Walk up to the root, however deep: the `seen` set stops a cycle.
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const topic = await this.deps.findTopic(cursor);
      const openedBy = topic?.metadata?.openedBy;
      if (!openedBy?.topicId || openedBy.detachedAt) return false;
      if (openedBy.topicId === openerTopicId) return true;
      cursor = openedBy.topicId;
    }
    return false;
  }

  /** Move sub-topics to the top level, once the caller may edit each of them. */
  private async detachChecked(topicIds: string[]) {
    if (topicIds.length === 0) return [];
    await this.deps.assertCanEditTopics(topicIds);
    return this.deps.detachTopics(topicIds);
  }

  /** Move sub-topics to the top level. */
  async detach(topicIds: string[]) {
    const topics = (
      await pMap(topicIds, (id) => this.deps.findTopic(id), { concurrency: FIND_TOPIC_CONCURRENCY })
    ).filter((topic): topic is TopicRow => !!topic);
    const runRows = topics.filter((topic) => topic.trigger === 'task');
    if (runRows.length > 0) {
      throw new SubTopicError(
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

    const detached = await this.detachChecked(topics.map((topic) => topic.id));
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
