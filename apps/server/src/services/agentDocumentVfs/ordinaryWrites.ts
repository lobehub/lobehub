import { buildDocumentFilename } from '@/database/models/agentDocuments';
import { DOCUMENT_FOLDER_TYPE } from '@/database/schemas';

import { RAW_TEXT_DOCUMENT_FILE_TYPE } from '../agentDocuments/contentFormat';
import { createAgentMarkdownSnapshot } from '../agentDocuments/headlessEditor';
import type { AgentDocumentVfsDeps } from './deps';
import { AgentDocumentVfsError } from './errors';
import { toOrdinaryStats } from './nodes';
import { resolveOrdinaryPath } from './ordinaryTree';
import {
  buildOrdinaryPath,
  LOBE_PATH,
  normalizeOrdinaryDocumentPath,
  splitAgentDocumentPath,
} from './paths';
import type {
  AgentDocumentCopyOptions,
  AgentDocumentStats,
  AgentDocumentVfsContext,
  AgentDocumentWriteOptions,
} from './types';

export async function writeOrdinaryDocument(
  deps: AgentDocumentVfsDeps,
  path: string,
  content: string,
  ctx: AgentDocumentVfsContext,
  createMode: NonNullable<AgentDocumentWriteOptions['createMode']>,
  contentFormat: NonNullable<AgentDocumentWriteOptions['contentFormat']>,
): Promise<AgentDocumentStats> {
  if (path === './' || path === LOBE_PATH || path.startsWith(`${LOBE_PATH}/`)) {
    throw new AgentDocumentVfsError(`Cannot write reserved path: ${path}`, 'BAD_REQUEST');
  }

  const exactExisting = await resolveOrdinaryPath(deps, path, ctx.agentId);
  const writablePath = exactExisting ? path : normalizeOrdinaryDocumentPath(path);
  const existing = exactExisting ?? (await resolveOrdinaryPath(deps, writablePath, ctx.agentId));

  if (existing) {
    if (existing.fileType === DOCUMENT_FOLDER_TYPE) {
      throw new AgentDocumentVfsError(`Path is not a file: ${writablePath}`, 'BAD_REQUEST');
    }

    if (createMode === 'always-new') {
      throw new AgentDocumentVfsError(`Path already exists: ${writablePath}`, 'BAD_REQUEST');
    }

    if (contentFormat === 'raw') {
      await deps.agentDocumentModel.update(existing.id, {
        content,
        editorData: null,
        fileType: RAW_TEXT_DOCUMENT_FILE_TYPE,
      });
    } else {
      const snapshot = await createAgentMarkdownSnapshot(content);
      const inRoom = await deps.writeThroughRoom(existing.documentId, {
        editorData: snapshot.editorData,
        markdown: snapshot.content,
      });
      if (!inRoom) {
        await deps.agentDocumentModel.update(existing.id, {
          content: snapshot.content,
          editorData: snapshot.editorData,
        });
      }
    }

    const updated = await resolveOrdinaryPath(deps, writablePath, ctx.agentId);

    if (!updated) {
      throw new AgentDocumentVfsError(
        `Failed to reload updated path: ${writablePath}`,
        'BAD_REQUEST',
      );
    }

    return toOrdinaryStats(updated, writablePath);
  }

  if (createMode === 'must-exist') {
    throw new AgentDocumentVfsError(`Path not found: ${writablePath}`, 'NOT_FOUND');
  }

  const segments = splitAgentDocumentPath(writablePath);
  const filename = segments.at(-1);

  if (!filename) {
    throw new AgentDocumentVfsError(`Invalid VFS path: ${writablePath}`, 'BAD_REQUEST');
  }

  const parentPath = segments.length === 1 ? './' : `./${segments.slice(0, -1).join('/')}`;
  const parentNode =
    parentPath === './' ? undefined : await resolveOrdinaryPath(deps, parentPath, ctx.agentId);

  if (parentPath !== './' && !parentNode) {
    throw new AgentDocumentVfsError(`Parent path not found: ${parentPath}`, 'BAD_REQUEST');
  }

  if (parentNode && parentNode.fileType !== DOCUMENT_FOLDER_TYPE) {
    throw new AgentDocumentVfsError(`Parent path is not a directory: ${parentPath}`, 'BAD_REQUEST');
  }

  const normalizedFilename = buildDocumentFilename(filename);
  if (contentFormat === 'raw') {
    const created = await deps.agentDocumentModel.create(ctx.agentId, normalizedFilename, content, {
      fileType: RAW_TEXT_DOCUMENT_FILE_TYPE,
      parentId: parentNode?.documentId ?? null,
      title: normalizedFilename,
    });

    return toOrdinaryStats(created, buildOrdinaryPath(parentPath, normalizedFilename));
  }

  const snapshot = await createAgentMarkdownSnapshot(content);
  const created = await deps.agentDocumentModel.create(
    ctx.agentId,
    normalizedFilename,
    snapshot.content,
    {
      editorData: snapshot.editorData,
      parentId: parentNode?.documentId ?? null,
      title: normalizedFilename,
    },
  );

  return toOrdinaryStats(created, buildOrdinaryPath(parentPath, normalizedFilename));
}

export async function renameOrdinaryPath(
  deps: AgentDocumentVfsDeps,
  sourcePath: string,
  destinationPath: string,
  ctx: AgentDocumentVfsContext,
  options: AgentDocumentCopyOptions,
  deletePath: (path: string, ctx: AgentDocumentVfsContext) => Promise<void>,
): Promise<AgentDocumentStats> {
  if (
    destinationPath === './' ||
    destinationPath === LOBE_PATH ||
    destinationPath.startsWith(`${LOBE_PATH}/`)
  ) {
    throw new AgentDocumentVfsError(
      `Cannot rename to reserved path: ${destinationPath}`,
      'BAD_REQUEST',
    );
  }

  const sourceNode = await resolveOrdinaryPath(deps, sourcePath, ctx.agentId);

  if (!sourceNode) {
    throw new AgentDocumentVfsError(`Path not found: ${sourcePath}`, 'NOT_FOUND');
  }

  const existingDestination = await resolveOrdinaryPath(deps, destinationPath, ctx.agentId);

  if (existingDestination) {
    if (!options.overwrite) {
      throw new AgentDocumentVfsError(`Path already exists: ${destinationPath}`, 'BAD_REQUEST');
    }

    if (existingDestination.fileType === DOCUMENT_FOLDER_TYPE) {
      throw new AgentDocumentVfsError(
        `Cannot overwrite directory path: ${destinationPath}`,
        'BAD_REQUEST',
      );
    }

    await deletePath(destinationPath, ctx);
  }

  const segments = splitAgentDocumentPath(destinationPath);
  const filename = segments.at(-1);

  if (!filename) {
    throw new AgentDocumentVfsError(`Invalid VFS path: ${destinationPath}`, 'BAD_REQUEST');
  }

  const parentPath = segments.length === 1 ? './' : `./${segments.slice(0, -1).join('/')}`;
  const parentNode =
    parentPath === './' ? undefined : await resolveOrdinaryPath(deps, parentPath, ctx.agentId);

  if (parentPath !== './' && !parentNode) {
    throw new AgentDocumentVfsError(`Parent path not found: ${parentPath}`, 'BAD_REQUEST');
  }

  if (parentNode && parentNode.fileType !== DOCUMENT_FOLDER_TYPE) {
    throw new AgentDocumentVfsError(`Parent path is not a directory: ${parentPath}`, 'BAD_REQUEST');
  }

  const parentId = parentNode?.documentId ?? null;
  const moved = await deps.agentDocumentModel.movePath(sourceNode.id, {
    filename,
    parentId,
  });

  if (!moved) {
    throw new AgentDocumentVfsError(`Failed to rename path: ${sourcePath}`, 'BAD_REQUEST');
  }

  return toOrdinaryStats(moved, destinationPath);
}
