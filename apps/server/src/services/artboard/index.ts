import { randomUUID } from 'node:crypto';

import type { ArtboardItem, ArtboardOp } from '@lobechat/types';
import { checkFinalizeReadiness } from '@lobechat/types';
import pMap from 'p-map';

import { AcceptanceModel } from '@/database/models/acceptance';
import { AcceptanceFlowModel } from '@/database/models/acceptanceFlow';
import { ArtboardModel, type ArtboardRow } from '@/database/models/artboard';
import { ArtboardCommentModel } from '@/database/models/artboard/comment';
import { ArtboardStructureModel } from '@/database/models/artboard/structure';
import { TaskModel } from '@/database/models/task';
import { TopicModel } from '@/database/models/topic';
import { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { TaskService } from '@/server/services/task';

import {
  type ArtboardCommentInput,
  ArtboardCommentService,
  type ArtboardQuestionInput,
} from './comments';
import { artboardConflict, ArtboardServiceError, guardArtboard, requireRowId } from './errors';
import { buildJourneyFlow } from './finalize';
import { applyArtboardOps } from './ops';
import {
  ARTBOARD_SOURCE_CONCURRENCY,
  type ArtboardSourceResolver,
  createArtboardSourceResolver,
  resolveOpSources,
} from './sources';
import { describeArtboard, toArtboardContent, toArtboardItem, withoutDraftPicks } from './view';

export type { ArtboardCommentInput, ArtboardQuestionInput } from './comments';
export type { ArtboardServiceErrorCode } from './errors';
export { ArtboardServiceError } from './errors';
export { describeArtboard } from './view';

export const ARTBOARD_TOOL_IDENTIFIER = 'lobe-artboard';

export interface ArtboardContext {
  agentId?: string | null;
  taskId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}

export interface ArtboardCreateInput {
  description?: string | null;
  ops?: ArtboardOp[];
  taskId?: string | null;
  title: string;
}

export interface ArtboardWriteResult {
  artboard: ArtboardItem;
  changedIds: string[];
}

export interface ArtboardCreateResult extends ArtboardWriteResult {
  createdTask: boolean;
  task: { id: string; identifier: string };
}

export interface ArtboardReadResult {
  artboard: ArtboardItem;
  canvases: Record<string, { latestVersion: number; title: string } | null>;
  staleBoardIds: string[];
}

export interface ArtboardViewResult {
  artboard: ArtboardItem;
  imageUrls: Record<string, string>;
}

export interface ArtboardFinalizeResult {
  acceptanceId: string;
  artboard: ArtboardItem;
}

export interface ArtboardServiceOptions {
  context?: ArtboardContext;
  sources?: ArtboardSourceResolver;
}

const notFound = (id: string) =>
  new ArtboardServiceError('not_found', `Artboard "${id}" was not found.`);

export class ArtboardService {
  private artboards: ArtboardModel;
  private structure: ArtboardStructureModel;
  private comments: ArtboardCommentModel;
  private commentService: ArtboardCommentService;
  private sources: ArtboardSourceResolver;
  private agentId: string | null;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
    options: ArtboardServiceOptions = {},
  ) {
    this.artboards = new ArtboardModel(db, userId, workspaceId);
    this.structure = new ArtboardStructureModel(db, userId, workspaceId);
    this.comments = new ArtboardCommentModel(db, userId, workspaceId);
    this.agentId = options.context?.agentId ?? null;
    this.commentService = new ArtboardCommentService({
      agentId: this.agentId,
      comments: this.comments,
      requireArtboard: (id) => this.require(id),
      structure: this.structure,
    });
    this.sources =
      options.sources ??
      createArtboardSourceResolver(db, { ...options.context, userId, workspaceId });
  }

  private async require(id: string) {
    const row = await this.artboards.findById(id);
    if (!row) throw notFound(id);
    return row;
  }

  private async content(id: string) {
    const [structure, openThreads] = await Promise.all([
      this.structure.getStructure(id),
      this.comments.listThreads(id, { unresolvedOnly: true }),
    ]);
    if (!structure) throw notFound(id);
    const versionIds = [
      ...new Set(structure.boards.flatMap((board) => board.sourceWorkVersionId ?? [])),
    ];
    return toArtboardContent(structure, openThreads, await this.sources.canvasVersions(versionIds));
  }

  private item = async (row: ArtboardRow) => toArtboardItem(row, await this.content(row.id));

  private items = (rows: ArtboardRow[]) =>
    pMap(rows, this.item, { concurrency: ARTBOARD_SOURCE_CONCURRENCY });

  private async resolveTask(ref: string) {
    const task = await new TaskModel(this.db, this.userId, this.workspaceId).resolve(ref);
    if (!task) throw new ArtboardServiceError('not_found', `Task "${ref}" was not found.`);
    return task;
  }

  private async topicProjectId(topicId?: string | null) {
    if (!topicId) return null;
    const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(topicId);
    return topic?.projectId ?? null;
  }

  private async contextProjectId(context: ArtboardContext) {
    if (context.taskId) {
      const task = await new TaskModel(this.db, this.userId, this.workspaceId).resolve(
        context.taskId,
      );
      if (task?.projectId) return task.projectId;
    }
    return this.topicProjectId(context.topicId);
  }

  async create(
    input: ArtboardCreateInput,
    context: ArtboardContext,
  ): Promise<ArtboardCreateResult> {
    const taskRef = input.taskId ?? context.taskId;
    const existingTask = taskRef ? await this.resolveTask(taskRef) : undefined;
    const projectId = existingTask
      ? existingTask.projectId
      : await this.topicProjectId(context.topicId);
    if (!projectId)
      throw new ArtboardServiceError(
        'no_project',
        'An artboard belongs to a project task. Open it from a project conversation, or pass a taskId of a task in a project.',
      );

    if (existingTask) {
      const [existing] = await this.artboards.listByTaskId(existingTask.id);
      if (existing)
        throw new ArtboardServiceError(
          'exists',
          `Task ${existingTask.identifier} already has artboard "${existing.id}". Read and update it instead.`,
          { artboardId: existing.id },
        );
    }

    const ops = await resolveOpSources(input.ops ?? [], this.sources);
    const { changedIds, row } = await guardArtboard(() =>
      this.db.transaction(async (tx) => {
        const created = await this.artboards.withTransaction(tx).create({
          description: input.description ?? null,
          projectId,
          taskId: existingTask?.id ?? null,
          title: input.title,
          topicId: context.topicId ?? null,
        });
        const changed = await applyArtboardOps(this.structure.withTransaction(tx), created, ops);
        return { changedIds: changed, row: created };
      }),
    );

    const task = existingTask ?? (await this.createTaskFor(row, input, context));
    const attached = existingTask ? row : ((await this.artboards.setTask(row.id, task.id)) ?? row);
    return {
      artboard: await this.item(attached),
      changedIds,
      createdTask: !existingTask,
      task: { id: task.id, identifier: task.identifier },
    };
  }

  // The task is created after the board so a refused op leaves no task behind.
  private async createTaskFor(
    row: ArtboardRow,
    input: ArtboardCreateInput,
    context: ArtboardContext,
  ) {
    try {
      return await new TaskService(this.db, this.userId, this.workspaceId).createTask({
        createdByAgentId: context.agentId ?? undefined,
        instruction: input.description || input.title,
        name: input.title,
        projectId: row.projectId ?? undefined,
      });
    } catch (error) {
      await this.artboards.delete(row.id);
      throw error;
    }
  }

  async update(id: string, revision: number, ops: ArtboardOp[]): Promise<ArtboardWriteResult> {
    const row = await this.require(id);
    if (row.revision !== revision) throw artboardConflict();
    const resolved = await resolveOpSources(ops, this.sources);

    const { changedIds, next } = await guardArtboard(() =>
      this.db.transaction(async (tx) => {
        const bumped = await this.artboards
          .withTransaction(tx)
          .update(id, { expectedRevision: revision });
        const changed = await applyArtboardOps(this.structure.withTransaction(tx), row, resolved);
        return { changedIds: changed, next: bumped };
      }),
    );
    return { artboard: await this.item(next), changedIds };
  }

  async read(id: string): Promise<ArtboardReadResult> {
    const artboard = withoutDraftPicks(await this.item(await this.require(id)));
    const sourced = artboard.content.boards.flatMap((board) =>
      board.source?.kind === 'canvas' ? [{ id: board.id, source: board.source }] : [],
    );
    const canvasIds = [...new Set(sourced.map((board) => board.source.canvasId))];
    const infos = await pMap(canvasIds, (canvasId) => this.sources.canvas(canvasId), {
      concurrency: ARTBOARD_SOURCE_CONCURRENCY,
    });
    const canvases = Object.fromEntries(
      canvasIds.map((canvasId, index) => {
        const info = infos[index];
        return [canvasId, info ? { latestVersion: info.version, title: info.title } : null];
      }),
    );
    const staleBoardIds = sourced
      .filter(({ source }) => {
        const latest = canvases[source.canvasId]?.latestVersion;
        return latest !== undefined && source.version < latest;
      })
      .map((board) => board.id);
    return { artboard, canvases, staleBoardIds };
  }

  async get(id: string): Promise<ArtboardViewResult> {
    const artboard = await this.item(await this.require(id));
    const fileIds = [
      ...new Set(
        artboard.content.boards.flatMap((board) =>
          board.source?.kind === 'image' ? [board.source.fileId] : [],
        ),
      ),
    ];
    const urls = await pMap(fileIds, (fileId) => this.sources.imageUrl(fileId), {
      concurrency: ARTBOARD_SOURCE_CONCURRENCY,
    });
    const imageUrls = Object.fromEntries(
      fileIds.flatMap((fileId, index) => (urls[index] ? [[fileId, urls[index]!]] : [])),
    );
    return { artboard, imageUrls };
  }

  async getRevision(id: string): Promise<number> {
    const revision = await this.artboards.getRevision(id);
    if (revision === undefined) throw notFound(id);
    return revision;
  }

  async getByTask(taskRef: string): Promise<ArtboardItem | null> {
    const task = await this.resolveTask(taskRef);
    const [row] = await this.artboards.listByTaskId(task.id);
    return row ? this.item(row) : null;
  }

  async listByProject(projectId: string): Promise<ArtboardItem[]> {
    return this.items(await this.artboards.listByProject(projectId));
  }

  async list(context: ArtboardContext): Promise<ArtboardItem[]> {
    const projectId = await this.contextProjectId(context);
    if (!projectId)
      throw new ArtboardServiceError(
        'no_project',
        'This conversation is not in a project, so it has no artboards.',
      );
    return this.listByProject(projectId);
  }

  private async requireRound(id: string, roundId: string) {
    await this.require(id);
    const structure = await this.structure.getStructure(id);
    if (!structure?.rounds.some((round) => round.id === roundId))
      throw new ArtboardServiceError('not_found', `Artboard "${id}" has no round ${roundId}.`);
  }

  async chooseBoard(id: string, roundId: string, boardId: string) {
    await this.requireRound(id, roundId);
    requireRowId(boardId, 'board');
    await guardArtboard(() => this.structure.chooseBoard(roundId, boardId));
    return { artboard: await this.item(await this.require(id)) };
  }

  async submitRound(id: string, roundId: string) {
    await this.requireRound(id, roundId);
    await guardArtboard(() => this.structure.submitRound(roundId));
    return { artboard: await this.item(await this.require(id)) };
  }

  async submitOpenRounds(id: string, roundIds?: string[]) {
    await this.require(id);
    const rounds = await guardArtboard(() => this.structure.submitOpenRounds(id, roundIds));
    return { artboard: await this.item(await this.require(id)), submitted: rounds.length };
  }

  listComments = (id: string) => this.commentService.list(id);

  countUndeliveredComments = (id: string) => this.commentService.countUndelivered(id);

  takeUndeliveredComments = (id: string) => this.commentService.takeUndelivered(id);

  async unreadCommentNotices(projectId: string, topicId: string) {
    const rows = (await this.artboards.listByProject(projectId)).filter(
      (row) => row.topicId === topicId,
    );
    const notices = await pMap(
      rows,
      async ({ id, title }) => ({
        id,
        threads: await this.commentService.countUndelivered(id),
        title,
      }),
      { concurrency: ARTBOARD_SOURCE_CONCURRENCY },
    );
    return notices.filter((notice) => notice.threads > 0);
  }

  addComment = (id: string, input: ArtboardCommentInput) =>
    this.commentService.open(id, input, null);

  askQuestion = (id: string, input: ArtboardQuestionInput) => this.commentService.ask(id, input);

  replyComment = (commentId: string, input: { clientId?: string; content: string }) =>
    this.commentService.reply(commentId, input);

  resolveComment = (commentId: string) => this.commentService.settle(commentId, true);

  reopenComment = (commentId: string) => this.commentService.settle(commentId, false);

  async finalize(id: string, revision: number): Promise<ArtboardFinalizeResult> {
    const row = await this.require(id);
    if (row.phase === 'finalized' && row.acceptanceId)
      return { acceptanceId: row.acceptanceId, artboard: await this.item(row) };
    if (row.revision !== revision) throw artboardConflict();
    const { taskId } = row;
    if (!taskId)
      throw new ArtboardServiceError('invalid', 'The board has no task to accept against.');

    const content = await this.content(id);
    const issues = checkFinalizeReadiness(content);
    if (issues.length)
      throw new ArtboardServiceError('finalize_blocked', 'The board is not ready to finalize.', {
        issues,
      });

    const next = await guardArtboard(() =>
      this.db.transaction(async (tx) => {
        const txDb = tx as unknown as LobeChatDatabase;
        const acceptance = await new AcceptanceModel(
          txDb,
          this.userId,
          this.workspaceId,
        ).ensureForSubject('task', taskId, {
          metadata: { title: row.title },
          projectId: row.projectId,
          requirement: row.title,
        });
        const flow = buildJourneyFlow(content, randomUUID);
        await new AcceptanceFlowModel(txDb, acceptance.userId).publish(
          acceptance.id,
          flow.definition,
        );

        const structure = this.structure.withTransaction(tx);
        for (const [boardId, acceptanceFlowNodeId] of Object.entries(flow.boardNodeIds))
          await structure.updateBoard(boardId, { acceptanceFlowNodeId });
        for (const [edgeId, acceptanceFlowEdgeId] of Object.entries(flow.edgeFlowIds))
          await structure.updateEdge(edgeId, { acceptanceFlowEdgeId });

        const updated = await this.artboards.withTransaction(tx).update(id, {
          acceptanceId: acceptance.id,
          expectedRevision: revision,
          phase: 'finalized',
        });
        await new WorkModel(txDb, this.userId, this.workspaceId).registerArtboard({
          artboardId: id,
          changeType: 'updated',
          description: describeArtboard(content),
          projectId: updated.projectId,
          title: updated.title,
          toolIdentifier: ARTBOARD_TOOL_IDENTIFIER,
          toolName: 'finalizeArtboard',
        });
        return updated;
      }),
    );
    return { acceptanceId: next.acceptanceId!, artboard: await this.item(next) };
  }
}
