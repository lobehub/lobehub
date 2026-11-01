import { createHash } from 'node:crypto';

import type { WorkVersionItem } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import type { WorkModel } from '@/database/models/work';
import { CanvasVersionConflictError } from '@/database/models/work/canvas';

import type { CanvasStorageService } from './storage';

export interface SaveCanvasInput {
  canvasId?: string;
  expectedVersion: number;
  html: string;
  requestId: string;
  title: string;
}

export const saveCanvas = async (
  input: SaveCanvasInput,
  deps: {
    storage: CanvasStorageService;
    userId: string;
    workModel: WorkModel;
    workspaceId?: string;
  },
) => {
  const { storage, userId, workModel, workspaceId } = deps;
  // A lost create response must still resolve to the same scoped identity.
  const canvasId =
    input.canvasId ??
    `cvs_${createHash('sha256')
      .update(JSON.stringify([userId, workspaceId ?? null, input.requestId]))
      .digest('hex')
      .slice(0, 32)}`;
  const current = await workModel.findCanvas(canvasId);
  if (input.canvasId && !current) throw new TRPCError({ code: 'NOT_FOUND' });
  if (current && current.work.userId !== userId) throw new TRPCError({ code: 'FORBIDDEN' });

  const toolCallId = `cli:${input.requestId}`;
  const result = (version: WorkVersionItem) => ({
    canvasId,
    version: version.version,
    workId: version.workId,
  });
  const replay = await workModel.findCanvasVersionByToolCall(canvasId, toolCallId);
  if (replay?.metadata?.canvas) {
    const manifest = await storage.readManifest(replay.metadata.canvas.manifestKey);
    const hash = createHash('sha256').update(input.html).digest('hex');
    if (
      replay.title !== input.title ||
      Object.keys(manifest.files).length !== 1 ||
      manifest.files['index.html']?.hash !== hash
    ) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This save request was already used for different content',
      });
    }
    return result(replay);
  }

  if ((current?.version.version ?? 0) !== input.expectedVersion) {
    throw new TRPCError({ code: 'CONFLICT', message: new CanvasVersionConflictError().message });
  }
  const saved = await storage.commit(canvasId, [{ content: input.html, path: 'index.html' }]);
  if (!saved.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: saved.issues
        .map(
          (issue) =>
            `${issue.file ?? 'index.html'}${issue.line ? `:${issue.line}` : ''} [${issue.rule}]: ${issue.message}`,
        )
        .join('\n'),
    });
  }
  try {
    await workModel.registerCanvas({
      canvasId,
      description: current?.work.description,
      expectedVersion: input.expectedVersion,
      metadata: saved.metadata,
      title: input.title,
      toolCallId,
      toolIdentifier: 'lobe-canvas',
      toolName: 'saveCanvas',
    });
  } catch (error) {
    if (error instanceof CanvasVersionConflictError) {
      throw new TRPCError({ cause: error, code: 'CONFLICT', message: error.message });
    }
    throw error;
  }
  const registered = await workModel.findCanvasVersionByToolCall(canvasId, toolCallId);
  if (!registered)
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Canvas version registration failed',
    });
  // Registration deduplicates under its row lock, including racing requests.
  if (
    registered.title !== input.title ||
    registered.metadata?.canvas?.manifestKey !== saved.metadata.manifestKey
  ) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This save request was already used for different content',
    });
  }
  return result(registered);
};
