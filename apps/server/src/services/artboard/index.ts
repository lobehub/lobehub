import { randomUUID } from 'node:crypto';

import { ArtboardIdentifier } from '@lobechat/builtin-tool-artboard';
import type { ArtboardItem, ArtboardOp } from '@lobechat/types';
import { checkFinalizeReadiness } from '@lobechat/types';
import pMap from 'p-map';

import { AcceptanceModel } from '@/database/models/acceptance';
import { AcceptanceFlowModel } from '@/database/models/acceptanceFlow';
import { ArtboardModel, type ArtboardRow } from '@/database/models/artboard';
import { ArtboardCommentModel } from '@/database/models/artboard/comment';
import { ArtboardStructureModel } from '@/database/models/artboard/structure';
import { ArtboardFileModel } from '@/database/models/artboardFile';
import { TaskModel } from '@/database/models/task';
import { TopicModel } from '@/database/models/topic';
import { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';
import { TaskService } from '@/server/services/task';

import {
  type ArtboardCommentInput,
  ArtboardCommentService,
  type ArtboardQuestionInput,
} from './comments';
import { artboardConflict, ArtboardServiceError, guardArtboard, requireRowId } from './errors';
import { artboardFileBasePath } from './fileAccess';
import {
  type ArtboardBlobStore,
  type ArtboardFileChanges,
  type ArtboardFilePlan,
  ArtboardFileService,
  type ArtboardFileUploadRequest,
  artboardFileUsage,
  createFileServiceArtboardBlobStore,
} from './files';
import { buildJourneyFlow } from './finalize';
import { applyArtboardOps, assertJourneyFilesKept } from './ops';
import {
  ARTBOARD_SOURCE_CONCURRENCY,
  type ArtboardSourceResolver,
  createArtboardSourceResolver,
} from './sources';
import { describeArtboard, toArtboardContent, toArtboardItem, withoutDraftPicks } from './view';

export type { ArtboardCommentInput, ArtboardQuestionInput } from './comments';
export type { ArtboardServiceErrorCode } from './errors';
export { ArtboardServiceError } from './errors';
export { describeArtboard } from './view';

export const ARTBOARD_TOOL_IDENTIFIER = ArtboardIdentifier;

export interface ArtboardContext {
  agentId?: string | null;
  taskId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}

export interface ArtboardCreateInput {
  description?: string | null;
  files?: ArtboardFileChanges;
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
}

export interface ArtboardViewResult {
  artboard: ArtboardItem;
  fileBaseUrl: string | null;
}

export interface ArtboardFinalizeResult {
  acceptanceId: string;
  artboard: ArtboardItem;
}

export interface ArtboardServiceOptions {
  context?: ArtboardContext;
  fileStore?: ArtboardBlobStore;
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
  private files: ArtboardFileService;
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
      fileHashes: async (id) =>
        new Map((await this.files.list(id)).map((file) => [file.path, file.hash])),
      requireArtboard: (id) => this.require(id),
      structure: this.structure,
    });
    this.sources =
      options.sources ??
      createArtboardSourceResolver(db, { ...options.context, userId, workspaceId });
    this.files = new ArtboardFileService({
      resolveImage: (fileRef) => this.sources.imageBytes(fileRef),
      resolveImport: (source) => this.sources.importPage(source),
      store:
        options.fileStore ??
        createFileServiceArtboardBlobStore(() => new FileService(db, userId, workspaceId)),
      usage: artboardFileUsage(new ArtboardFileModel(db, userId, workspaceId)),
    });
  }

  private async require(id: string) {
    const row = await this.artboards.findById(id);
    if (!row) throw notFound(id);
    return row;
  }

  private async content(id: string) {
    const [structure, openThreads, files] = await Promise.all([
      this.structure.getStructure(id),
      this.comments.listThreads(id, { unresolvedOnly: true }),
      this.files.list(id),
    ]);
    if (!structure) throw notFound(id);
    return toArtboardContent(
      structure,
      openThreads,
      new Map(files.map((file) => [file.path, file.hash])),
    );
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

    const { changedIds, files, row } = await guardArtboard(() =>
      this.db.transaction(async (tx) => {
        const created = await this.artboards.withTransaction(tx).create({
          description: input.description ?? null,
          projectId,
          taskId: existingTask?.id ?? null,
          title: input.title,
          topicId: context.topicId ?? null,
        });
        // Validated before the row commits; stored after, since only then does the id exist.
        const files = await this.files.prepare(created.id, input.files ?? {});
        const changed = await applyArtboardOps(
          this.structure.withTransaction(tx),
          created,
          input.ops ?? [],
        );
        return { changedIds: changed, files, row: created };
      }),
    );
    await this.files.apply(row.id, files);

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
      await this.files.removeAll(row.id);
      throw error;
    }
  }

  async update(
    id: string,
    revision: number,
    ops: ArtboardOp[],
    changes: ArtboardFileChanges = {},
  ): Promise<ArtboardWriteResult> {
    const row = await this.require(id);
    if (row.revision !== revision) throw artboardConflict();
    const files = await this.prepareFiles(row, changes);

    const { changedIds } = await guardArtboard(() =>
      this.db.transaction(async (tx) => {
        await this.artboards.withTransaction(tx).update(id, { expectedRevision: revision });
        const changed = await applyArtboardOps(this.structure.withTransaction(tx), row, ops);
        return { changedIds: changed };
      }),
    );
    const next = await this.storeFiles(id, files);
    return { artboard: await this.item(next ?? (await this.require(id))), changedIds };
  }

  async writeFiles(id: string, changes: ArtboardFileChanges) {
    const plan = await this.prepareFiles(await this.require(id), changes);
    await this.storeFiles(id, plan);
    return { files: ArtboardFileService.touched(plan) };
  }

  /** Validate file changes; a finalized journey keeps the files its boards show. */
  private async prepareFiles(row: ArtboardRow, changes: ArtboardFileChanges) {
    const plan = await this.files.prepare(row.id, changes);
    const touched = ArtboardFileService.touched(plan);
    if (row.phase === 'finalized' && touched.length) {
      const structure = await this.structure.getStructure(row.id);
      if (structure) assertJourneyFilesKept(row, structure, touched);
    }
    return plan;
  }

  /** Store the files, then move updatedAt so open boards reload (writes do not bump revision). */
  private async storeFiles(id: string, plan: ArtboardFilePlan) {
    await this.files.apply(id, plan);
    return this.artboards.touch(id);
  }

  async listFiles(id: string) {
    await this.require(id);
    return this.files.list(id);
  }

  async readFile(id: string, path: string) {
    await this.require(id);
    return this.files.read(id, path);
  }

  async prepareFileUploads(id: string, files: ArtboardFileUploadRequest[]) {
    await this.require(id);
    return this.files.prepareUploads(id, files);
  }

  async read(id: string): Promise<ArtboardReadResult> {
    return { artboard: withoutDraftPicks(await this.item(await this.require(id))) };
  }

  async get(id: string): Promise<ArtboardViewResult> {
    return {
      artboard: await this.item(await this.require(id)),
      fileBaseUrl: artboardFileBasePath(id) ?? null,
    };
  }

  async getRevision(id: string): Promise<{ revision: number; updatedAt: Date }> {
    const stamp = await this.artboards.getRevision(id);
    if (!stamp) throw notFound(id);
    return stamp;
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
