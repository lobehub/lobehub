import { randomUUID } from 'node:crypto';

import type {
  ArtboardContent,
  ArtboardItem,
  ArtboardOp,
  ArtboardUserOp,
  ResolvedArtboardOp,
} from '@lobechat/types';
import { EMPTY_ARTBOARD_CONTENT } from '@lobechat/types';
import pMap from 'p-map';

import { AcceptanceModel } from '@/database/models/acceptance';
import { AcceptanceFlowModel } from '@/database/models/acceptanceFlow';
import { ArtboardModel, ArtboardRevisionConflictError } from '@/database/models/artboard';
import { TaskModel } from '@/database/models/task';
import { TopicModel } from '@/database/models/topic';
import { WorkModel } from '@/database/models/work';
import type { ArtboardRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { TaskService } from '@/server/services/task';

import { applyArtboardOps, applyArtboardUserOps, ArtboardOpError } from './content/applyOps';
import { buildJourneyFlow, checkFinalizeReadiness } from './content/finalize';
import { ArtboardServiceError } from './errors';
import {
  ARTBOARD_SOURCE_CONCURRENCY,
  type ArtboardSourceResolver,
  createArtboardSourceResolver,
  resolveOpSources,
} from './sources';

export type { ArtboardServiceErrorCode } from './errors';
export { ArtboardServiceError } from './errors';

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
  staleFrameIds: string[];
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

export const describeArtboard = (content: ArtboardContent) =>
  `${content.groups.length} groups · ${content.frames.length} frames`;

const toItem = (row: ArtboardRow): ArtboardItem => ({
  acceptanceId: row.acceptanceId,
  content: row.content,
  createdAt: row.createdAt,
  description: row.description,
  id: row.id,
  originTopicId: row.originTopicId,
  phase: row.phase,
  projectId: row.projectId,
  revision: row.revision,
  taskId: row.taskId,
  title: row.title,
  updatedAt: row.updatedAt,
});

const conflict = () =>
  new ArtboardServiceError(
    'conflict',
    'The board changed since you read it. Call readArtboard for the latest revision, then retry.',
  );

const fromOpError = (error: unknown): never => {
  if (error instanceof ArtboardOpError)
    throw new ArtboardServiceError(error.code === 'locked' ? 'locked' : 'invalid', error.message, {
      opIndex: error.opIndex,
    });
  if (error instanceof ArtboardRevisionConflictError) throw conflict();
  throw error;
};

export class ArtboardService {
  private artboards: ArtboardModel;
  private sources: ArtboardSourceResolver;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
    options: ArtboardServiceOptions = {},
  ) {
    this.artboards = new ArtboardModel(db, userId, workspaceId);
    this.sources =
      options.sources ??
      createArtboardSourceResolver(db, { ...options.context, userId, workspaceId });
  }

  private async require(id: string) {
    const row = await this.artboards.findById(id);
    if (!row) throw new ArtboardServiceError('not_found', `Artboard "${id}" was not found.`);
    return row;
  }

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

  private apply(content: ArtboardContent, ops: ResolvedArtboardOp[], phase: ArtboardRow['phase']) {
    try {
      return applyArtboardOps(content, ops, { phase });
    } catch (error) {
      return fromOpError(error);
    }
  }

  private async write(
    row: ArtboardRow,
    revision: number,
    build: () => Promise<{ changedIds: string[]; content: ArtboardContent }>,
  ): Promise<ArtboardWriteResult> {
    if (row.revision !== revision) throw conflict();
    const { changedIds, content } = await build();
    try {
      const next = await this.artboards.update(row.id, { content, expectedRevision: revision });
      return { artboard: toItem(next), changedIds };
    } catch (error) {
      return fromOpError(error);
    }
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
      const existing = await this.artboards.findByTaskId(existingTask.id);
      if (existing)
        throw new ArtboardServiceError(
          'exists',
          `Task ${existingTask.identifier} already has artboard "${existing.id}". Read and update it instead.`,
          { artboardId: existing.id },
        );
    }

    const resolved = await resolveOpSources(input.ops ?? [], this.sources);
    const { changedIds, content } = this.apply(EMPTY_ARTBOARD_CONTENT, resolved, 'discuss');

    const task =
      existingTask ??
      (await new TaskService(this.db, this.userId, this.workspaceId).createTask({
        createdByAgentId: context.agentId ?? undefined,
        instruction: input.description || input.title,
        name: input.title,
        projectId,
      }));

    try {
      const row = await this.artboards.create({
        content,
        description: input.description ?? null,
        originTopicId: context.topicId ?? null,
        projectId,
        taskId: task.id,
        title: input.title,
      });
      return {
        artboard: toItem(row),
        changedIds,
        createdTask: !existingTask,
        task: { id: task.id, identifier: task.identifier },
      };
    } catch (error) {
      const raced = await this.artboards.findByTaskId(task.id);
      if (raced)
        throw new ArtboardServiceError(
          'exists',
          `Task ${task.identifier} already has artboard "${raced.id}". Read and update it instead.`,
          { artboardId: raced.id },
        );
      throw error;
    }
  }

  async update(id: string, revision: number, ops: ArtboardOp[]): Promise<ArtboardWriteResult> {
    const row = await this.require(id);
    return this.write(row, revision, async () =>
      this.apply(row.content, await resolveOpSources(ops, this.sources), row.phase),
    );
  }

  async applyUserOps(
    id: string,
    revision: number,
    ops: ArtboardUserOp[],
  ): Promise<ArtboardWriteResult> {
    const row = await this.require(id);
    return this.write(row, revision, async () => {
      try {
        return applyArtboardUserOps(row.content, ops, { phase: row.phase });
      } catch (error) {
        return fromOpError(error);
      }
    });
  }

  async read(id: string): Promise<ArtboardReadResult> {
    const row = await this.require(id);
    const canvasIds = [
      ...new Set(
        row.content.frames.flatMap((f) => (f.source.kind === 'canvas' ? [f.source.canvasId] : [])),
      ),
    ];
    const infos = await pMap(canvasIds, (canvasId) => this.sources.canvas(canvasId), {
      concurrency: ARTBOARD_SOURCE_CONCURRENCY,
    });
    const canvases = Object.fromEntries(
      canvasIds.map((canvasId, index) => {
        const info = infos[index];
        return [canvasId, info ? { latestVersion: info.version, title: info.title } : null];
      }),
    );
    const staleFrameIds = row.content.frames
      .filter((frame) => {
        if (frame.source.kind !== 'canvas') return false;
        const latest = canvases[frame.source.canvasId]?.latestVersion;
        return latest !== undefined && frame.source.version < latest;
      })
      .map((frame) => frame.id);
    return { artboard: toItem(row), canvases, staleFrameIds };
  }

  async get(id: string): Promise<ArtboardViewResult> {
    const row = await this.require(id);
    const fileIds = [
      ...new Set(
        row.content.frames.flatMap((f) => (f.source.kind === 'image' ? [f.source.fileId] : [])),
      ),
    ];
    const urls = await pMap(fileIds, (fileId) => this.sources.imageUrl(fileId), {
      concurrency: ARTBOARD_SOURCE_CONCURRENCY,
    });
    const imageUrls = Object.fromEntries(
      fileIds.flatMap((fileId, index) => (urls[index] ? [[fileId, urls[index]!]] : [])),
    );
    return { artboard: toItem(row), imageUrls };
  }

  async getRevision(id: string): Promise<number> {
    const revision = await this.artboards.getRevision(id);
    if (revision === undefined)
      throw new ArtboardServiceError('not_found', `Artboard "${id}" was not found.`);
    return revision;
  }

  async getByTask(taskRef: string): Promise<ArtboardItem | null> {
    const task = await this.resolveTask(taskRef);
    const row = await this.artboards.findByTaskId(task.id);
    return row ? toItem(row) : null;
  }

  async listByProject(projectId: string): Promise<ArtboardItem[]> {
    return (await this.artboards.listByProject(projectId)).map(toItem);
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

  async finalize(id: string, revision: number): Promise<ArtboardFinalizeResult> {
    const row = await this.require(id);
    if (row.phase === 'finalized' && row.acceptanceId)
      return { acceptanceId: row.acceptanceId, artboard: toItem(row) };
    if (row.revision !== revision) throw conflict();

    const issues = checkFinalizeReadiness(row.content);
    if (issues.length)
      throw new ArtboardServiceError('finalize_blocked', 'The board is not ready to finalize.', {
        issues,
      });

    try {
      const next = await this.db.transaction(async (tx) => {
        const txDb = tx as unknown as LobeChatDatabase;
        const acceptance = await new AcceptanceModel(
          txDb,
          this.userId,
          this.workspaceId,
        ).ensureForSubject('task', row.taskId, {
          metadata: { title: row.title },
          projectId: row.projectId,
          requirement: row.title,
        });
        const flow = buildJourneyFlow(row.content, randomUUID);
        await new AcceptanceFlowModel(txDb, acceptance.userId).publish(
          acceptance.id,
          flow.definition,
        );

        const content: ArtboardContent = {
          ...row.content,
          arrows: row.content.arrows.map((arrow) =>
            flow.arrowEdgeIds[arrow.id]
              ? { ...arrow, flowEdgeId: flow.arrowEdgeIds[arrow.id] }
              : arrow,
          ),
          frames: row.content.frames.map((frame) =>
            flow.frameNodeIds[frame.id]
              ? { ...frame, flowNodeId: flow.frameNodeIds[frame.id] }
              : frame,
          ),
        };
        const updated = await this.artboards.withTransaction(tx).update(id, {
          acceptanceId: acceptance.id,
          content,
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
      });
      return { acceptanceId: next.acceptanceId!, artboard: toItem(next) };
    } catch (error) {
      return fromOpError(error);
    }
  }
}
