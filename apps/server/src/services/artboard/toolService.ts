import type {
  ArtboardToolFailure,
  ArtboardToolService,
  ArtboardToolSnapshot,
} from '@lobechat/builtin-tool-artboard';
import {
  artboardFileChangesSchema,
  type ArtboardItem,
  type ArtboardOp,
  artboardOpSchema,
} from '@lobechat/types';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';

import type { ArtboardFileChanges } from './files';
import { type ArtboardContext, ArtboardService, ArtboardServiceError } from './index';

export interface ArtboardToolScope extends ArtboardContext {
  userId: string;
  workspaceId?: string;
}

const opsSchema = z.array(artboardOpSchema);

const toSnapshot = (artboard: ArtboardItem): ArtboardToolSnapshot => ({
  content: artboard.content,
  description: artboard.description,
  id: artboard.id,
  phase: artboard.phase,
  projectId: artboard.projectId,
  revision: artboard.revision,
  taskId: artboard.taskId,
  title: artboard.title,
});

const parseOps = (ops: unknown[] | undefined): ArtboardOp[] => {
  const parsed = opsSchema.safeParse(ops ?? []);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `ops.${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new ArtboardServiceError('invalid', `The ops are malformed: ${issues}`);
};

const parseFiles = (files: unknown): ArtboardFileChanges => {
  const parsed = artboardFileChangesSchema.safeParse(files ?? {});
  if (parsed.success) return parsed.data;
  throw new ArtboardServiceError(
    'invalid',
    `The files are malformed: ${parsed.error.issues.map((issue) => `files.${issue.path.join('.')}: ${issue.message}`).join('; ')}. Each write is {path, content}, {path, fileRef} or {path, fromCanvas: {canvasId}}; each edit is {path, oldText, newText}.`,
  );
};

const toFiles = (rows: { hash: string; path: string; size: number }[]) =>
  rows.map(({ hash, path, size }) => ({ hash, path, size }));

const guard = async <T>(action: () => Promise<T>): Promise<T | ArtboardToolFailure> => {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof ArtboardServiceError)) throw error;
    const at = error.data.opIndex === undefined ? '' : ` (op ${error.data.opIndex})`;
    return { code: error.code, message: `${error.message}${at}`, ok: false };
  }
};

export const createArtboardToolService = (
  db: LobeChatDatabase,
  scope: ArtboardToolScope,
): ArtboardToolService => {
  const { userId, workspaceId, ...context } = scope;
  const service = new ArtboardService(db, userId, workspaceId, { context });

  return {
    askQuestion: ({ id, ...question }) =>
      guard(async () => ({
        commentId: (await service.askQuestion(id, question)).id,
        ok: true as const,
      })),
    create: (params) =>
      guard(async () => {
        const result = await service.create(
          {
            description: params.description,
            files: parseFiles(params.files),
            ops: parseOps(params.ops),
            taskId: params.taskId,
            title: params.title,
          },
          context,
        );
        return {
          artboard: toSnapshot(result.artboard),
          changedIds: result.changedIds,
          ok: true as const,
          task: { createdTask: result.createdTask, identifier: result.task.identifier },
        };
      }),
    list: () =>
      guard(async () => ({
        artboards: (await service.list(context)).map((artboard) => ({
          id: artboard.id,
          phase: artboard.phase,
          revision: artboard.revision,
          taskId: artboard.taskId,
          title: artboard.title,
        })),
        ok: true as const,
      })),
    listComments: (params) =>
      guard(async () => ({
        ok: true as const,
        threads: await service.takeUndeliveredComments(params.id),
      })),
    read: (params) =>
      guard(async () => {
        const [result, files] = await Promise.all([
          service.read(params.id),
          service.listFiles(params.id),
        ]);
        return { artboard: toSnapshot(result.artboard), files: toFiles(files), ok: true as const };
      }),
    readFile: (params) =>
      guard(async () => {
        const file = await service.readFile(params.id, params.path);
        return { content: file.content ?? null, ok: true as const, path: file.path };
      }),
    replyComment: (params) =>
      guard(async () => ({
        commentId: (await service.replyComment(params.commentId, { content: params.content })).id,
        ok: true as const,
      })),
    resolveComment: (params) =>
      guard(async () => ({
        commentId: (await service.resolveComment(params.commentId)).id,
        ok: true as const,
      })),
    update: (params) =>
      guard(async () => {
        const result = await service.update(
          params.id,
          params.revision,
          parseOps(params.ops),
          parseFiles(params.files),
        );
        return {
          artboard: toSnapshot(result.artboard),
          changedIds: result.changedIds,
          ok: true as const,
        };
      }),
    writeFiles: ({ id, ...files }) =>
      guard(async () => ({
        ok: true as const,
        paths: (await service.writeFiles(id, parseFiles(files))).files,
      })),
  };
};
