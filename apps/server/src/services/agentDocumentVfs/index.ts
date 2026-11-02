import type { LobeChatDatabase } from '@lobechat/database';

import type { AgentDocument } from '@/database/models/agentDocuments';
import { AgentDocumentModel } from '@/database/models/agentDocuments';
import { DOCUMENT_FOLDER_TYPE } from '@/database/schemas';

import { getAgentDocumentContentType } from '../agentDocuments/contentFormat';
import { FileService } from '../file';
import { writePageBodyThroughRoom } from '../pageCollab/bodyWriter';
import type { AgentDocumentVfsDeps } from './deps';
import { AgentDocumentVfsError } from './errors';
import { deleteMountedSkill, writeMountedSkill } from './mountedSkills';
import { createSkillMount } from './mounts/skills/createSkillMount';
import { isUnifiedSkillPath as isSkillPath } from './mounts/skills/path';
import type { SkillMount } from './mounts/skills/SkillMount';
import {
  createSyntheticDirectoryNode,
  getSyntheticNode,
  listSyntheticChildren,
  toMountedNode,
  toMountedStats,
  toOrdinaryNode,
  toOrdinaryStats,
} from './nodes';
import { collectOrdinarySubtree, listOrdinaryNodes, resolveOrdinaryPath } from './ordinaryTree';
import { renameOrdinaryPath, writeOrdinaryDocument } from './ordinaryWrites';
import {
  applyListLimit,
  assertNotSelfReferentialCopy,
  buildOrdinaryPath,
  LOBE_PATH,
  normalizeAgentDocumentPath,
  sliceReadContent,
  splitAgentDocumentPath,
} from './paths';
import { resolveReadablePath } from './skillPaths';
import {
  deletePermanently,
  deletePermanentlyByPath,
  listTrash,
  restoreFromTrash,
  restoreFromTrashByPath,
} from './trash';
import type {
  AgentDocumentCopyOptions,
  AgentDocumentDeleteOptions,
  AgentDocumentListOptions,
  AgentDocumentMkdirOptions,
  AgentDocumentNode,
  AgentDocumentReadOptions,
  AgentDocumentReadResult,
  AgentDocumentStats,
  AgentDocumentTrashEntry,
  AgentDocumentVfsContext,
  AgentDocumentWriteOptions,
} from './types';

/**
 * Internal recursive copy safety cap.
 * This is intentionally separate from public listing pagination so `rename()` never drops children.
 */
const MAX_RECURSIVE_COPY_CHILDREN = 5000;

/**
 * Unified filesystem view for ordinary agent documents plus mounted subtrees.
 *
 * Use when:
 * - Router path APIs need one filesystem-shaped surface
 * - CLI commands should stop reasoning about skill-only path aliases
 *
 * Expects:
 * - Ordinary documents remain backed by `agent_documents` + `documents`
 * - Mounted subtrees can translate into existing services during migration
 *
 * Returns:
 * - Plain-data VFS nodes, stats, and read results
 *
 * Call stack:
 *
 * agentDocumentRouter.listDocumentsByPath/statDocumentByPath
 *   -> {@link AgentDocumentVfsService.list}
 *   -> {@link AgentDocumentVfsService.stat}
 *     -> ordinary document query helpers
 *     -> mounted subtree query helpers
 */
export class AgentDocumentVfsService {
  private agentDocumentModel: AgentDocumentModel;
  private skillMount: SkillMount;
  private fileServiceInstance?: FileService;

  private readonly deps: AgentDocumentVfsDeps;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.agentDocumentModel = new AgentDocumentModel(db, userId, workspaceId);
    this.skillMount = createSkillMount(db, userId, workspaceId);
    this.deps = {
      agentDocumentModel: this.agentDocumentModel,
      getFileService: () => this.fileService,
      skillMount: this.skillMount,
      writeThroughRoom: (documentId, body) =>
        writePageBodyThroughRoom(db, documentId, body, {
          saveSource: 'llm_call',
          userId,
          workspaceId,
        }),
    };
  }

  /** Defers storage configuration until a permanent deletion actually has uploads to reclaim. */
  private get fileService(): FileService {
    return (this.fileServiceInstance ??= new FileService(this.db, this.userId, this.workspaceId));
  }

  /**
   * Lists direct children for a unified VFS directory path.
   *
   * Use when:
   * - Implementing `ls` or `tree`
   * - Enumerating either ordinary documents or mounted subtree entries
   *
   * Expects:
   * - Only direct children are returned
   * - The current phase ignores pagination cursors while preserving the call shape
   *
   * Returns:
   * - Plain-data directory entries
   */
  async list(
    path: string,
    ctx: AgentDocumentVfsContext,
    options: AgentDocumentListOptions = {},
  ): Promise<AgentDocumentNode[]> {
    // NOTICE:
    // This directory listing does not copy Node.js `readdir` exactly.
    // The backend is document rows plus mounted subtrees rather than a local syscall-driven filesystem.
    // We keep `list` lightweight and avoid content loads so callers do not trigger a `list -> stat` N+1 loop.
    const normalizedPath = normalizeAgentDocumentPath(path);

    if (normalizedPath === './') {
      const [ordinaryNodes, lobeNode] = await Promise.all([
        listOrdinaryNodes(this.deps, ctx.agentId, null, './', options),
        Promise.resolve(createSyntheticDirectoryNode(LOBE_PATH, 'lobe')),
      ]);

      return [...ordinaryNodes, lobeNode];
    }

    const syntheticChildren = listSyntheticChildren(normalizedPath);

    if (syntheticChildren) return syntheticChildren;

    if (isSkillPath(normalizedPath)) {
      const nodes = await this.skillMount.list({
        agentId: ctx.agentId,
        path: normalizedPath,
        topicId: ctx.topicId,
      });

      return applyListLimit(
        nodes.map((node) => toMountedNode(node)),
        options,
      );
    }

    const parentNode = await resolveOrdinaryPath(this.deps, normalizedPath, ctx.agentId);

    if (!parentNode) {
      throw new AgentDocumentVfsError(`Path not found: ${normalizedPath}`, 'NOT_FOUND');
    }

    if (parentNode.fileType !== DOCUMENT_FOLDER_TYPE) {
      throw new AgentDocumentVfsError(`Path is not a directory: ${normalizedPath}`, 'BAD_REQUEST');
    }

    return listOrdinaryNodes(
      this.deps,
      ctx.agentId,
      parentNode.documentId,
      normalizedPath,
      options,
    );
  }

  /**
   * Resolves a unified VFS path into detailed node state.
   *
   * Use when:
   * - Implementing `stat`
   * - Backing the `statDocumentByPath` router API
   *
   * Returns:
   * - Detailed VFS node state or `undefined` when the path is not found
   */
  async stat(path: string, ctx: AgentDocumentVfsContext): Promise<AgentDocumentStats | undefined> {
    const normalizedPath = normalizeAgentDocumentPath(path);
    const syntheticNode = getSyntheticNode(normalizedPath);

    if (syntheticNode) return syntheticNode;

    if (isSkillPath(normalizedPath)) {
      const node = await this.skillMount.get({
        agentId: ctx.agentId,
        path: normalizedPath,
        topicId: ctx.topicId,
      });

      return toMountedStats(node);
    }

    const ordinaryNode = await resolveOrdinaryPath(this.deps, normalizedPath, ctx.agentId);
    return ordinaryNode ? toOrdinaryStats(ordinaryNode, normalizedPath) : undefined;
  }

  /**
   * Reads file content from a unified VFS path.
   *
   * Use when:
   * - A caller needs the file body rather than only `stat` metadata
   *
   * Returns:
   * - File content payload
   */
  async read(
    path: string,
    ctx: AgentDocumentVfsContext,
    options: AgentDocumentReadOptions = {},
  ): Promise<AgentDocumentReadResult> {
    const normalizedPath = normalizeAgentDocumentPath(path);

    if (isSkillPath(normalizedPath)) {
      const node = await this.skillMount.get({
        agentId: ctx.agentId,
        path: normalizedPath,
        topicId: ctx.topicId,
      });

      if (node.type !== 'file') {
        throw new AgentDocumentVfsError(`Path is not a file: ${path}`, 'BAD_REQUEST');
      }

      return {
        ...sliceReadContent(node.content ?? '', options.loc),
        contentType: node.contentType,
        path: node.path,
      };
    }

    const node = await resolveOrdinaryPath(this.deps, normalizedPath, ctx.agentId);

    if (!node) {
      throw new AgentDocumentVfsError(`Path not found: ${path}`, 'NOT_FOUND');
    }

    if (node.fileType === DOCUMENT_FOLDER_TYPE) {
      throw new AgentDocumentVfsError(`Path is not a file: ${path}`, 'BAD_REQUEST');
    }

    return {
      ...sliceReadContent(node.content, options.loc),
      contentType: getAgentDocumentContentType(node),
      path: normalizedPath,
    };
  }

  /**
   * Writes file content through the unified VFS surface.
   *
   * Use when:
   * - Updating an ordinary agent document by path
   * - Creating or updating a writable mounted skill entry during the migration period
   *
   * Expects:
   * - `createMode` controls whether missing paths are created or rejected
   *
   * Returns:
   * - The updated file state
   */
  async write(
    path: string,
    content: string,
    ctx: AgentDocumentVfsContext,
    options: AgentDocumentWriteOptions = {},
  ): Promise<AgentDocumentStats> {
    const normalizedPath = normalizeAgentDocumentPath(path);
    const createMode = options.createMode ?? 'if-missing';

    if (isSkillPath(normalizedPath)) {
      return writeMountedSkill(this.deps, normalizedPath, content, ctx, createMode);
    }

    return writeOrdinaryDocument(
      this.deps,
      normalizedPath,
      content,
      ctx,
      createMode,
      options.contentFormat ?? 'markdown',
    );
  }

  /**
   * Creates a directory through the unified VFS surface.
   *
   * Use when:
   * - CLI `mkdir` targets the ordinary document tree
   *
   * Returns:
   * - The created or existing directory state
   */
  async mkdir(
    path: string,
    ctx: AgentDocumentVfsContext,
    options: AgentDocumentMkdirOptions = {},
  ): Promise<AgentDocumentStats> {
    const normalizedPath = normalizeAgentDocumentPath(path);

    if (isSkillPath(normalizedPath)) {
      throw new AgentDocumentVfsError(
        `mkdir is not supported for mounted path: ${path}`,
        'BAD_REQUEST',
      );
    }

    if (
      normalizedPath === './' ||
      normalizedPath === LOBE_PATH ||
      normalizedPath.startsWith(`${LOBE_PATH}/`)
    ) {
      throw new AgentDocumentVfsError(`Cannot create reserved path: ${path}`, 'BAD_REQUEST');
    }

    const segments = splitAgentDocumentPath(normalizedPath);
    let parentId: string | null = null;
    let currentPath = './';
    let currentNode: AgentDocument | undefined;

    for (const [index, segment] of segments.entries()) {
      const isLeaf = index === segments.length - 1;
      const nextPath = buildOrdinaryPath(currentPath, segment);
      const existing = await this.agentDocumentModel.findByParentAndFilename(
        ctx.agentId,
        parentId,
        segment,
      );

      if (existing) {
        if (existing.fileType !== DOCUMENT_FOLDER_TYPE) {
          throw new AgentDocumentVfsError(
            `Path segment is not a directory: ${nextPath}`,
            'BAD_REQUEST',
          );
        }

        currentNode = existing;
        parentId = existing.documentId;
        currentPath = nextPath;
        continue;
      }

      if (!isLeaf && !options.recursive) {
        throw new AgentDocumentVfsError(`Parent path not found: ${nextPath}`, 'BAD_REQUEST');
      }

      const created = await this.agentDocumentModel.create(ctx.agentId, segment, '', {
        fileType: DOCUMENT_FOLDER_TYPE,
        parentId,
        title: segment,
      });

      currentNode = created;
      parentId = created.documentId;
      currentPath = nextPath;
    }

    if (!currentNode) {
      throw new AgentDocumentVfsError(`Invalid directory path: ${path}`, 'BAD_REQUEST');
    }

    return toOrdinaryStats(currentNode, normalizedPath);
  }

  /**
   * Renames or moves a path through the unified VFS surface.
   *
   * Use when:
   * - CLI `mv` needs filesystem-style `rename(from, to)`
   *
   * Returns:
   * - The destination node state
   */
  async rename(
    fromPath: string,
    toPath: string,
    ctx: AgentDocumentVfsContext,
    options: AgentDocumentCopyOptions = {},
  ): Promise<AgentDocumentStats> {
    const sourcePath = normalizeAgentDocumentPath(fromPath);
    const destinationPath = normalizeAgentDocumentPath(toPath);

    if (sourcePath === destinationPath) {
      const existing = await this.stat(sourcePath, ctx);

      if (!existing) {
        throw new AgentDocumentVfsError(`Path not found: ${fromPath}`, 'NOT_FOUND');
      }

      return existing;
    }

    const sourceNode = await this.stat(sourcePath, ctx);

    if (!sourceNode) {
      throw new AgentDocumentVfsError(`Path not found: ${fromPath}`, 'NOT_FOUND');
    }

    assertNotSelfReferentialCopy(sourcePath, destinationPath, sourceNode);

    if (!isSkillPath(sourcePath) && !isSkillPath(destinationPath)) {
      return renameOrdinaryPath(this.deps, sourcePath, destinationPath, ctx, options, (path, ctx) =>
        this.delete(path, ctx),
      );
    }

    const copied = await this.copy(sourcePath, destinationPath, ctx, options);
    await this.delete(sourcePath, ctx, {
      recursive: copied.type === 'directory',
    });

    return copied;
  }

  /**
   * Copies a path through the unified VFS surface.
   *
   * Use when:
   * - CLI `cp` needs filesystem-style path copying
   *
   * Returns:
   * - The destination node state
   */
  async copy(
    fromPath: string,
    toPath: string,
    ctx: AgentDocumentVfsContext,
    options: AgentDocumentCopyOptions = {},
  ): Promise<AgentDocumentStats> {
    const sourcePath = normalizeAgentDocumentPath(fromPath);
    const destinationPath = normalizeAgentDocumentPath(toPath);
    const sourceNode = await this.stat(sourcePath, ctx);

    if (!sourceNode) {
      throw new AgentDocumentVfsError(`Path not found: ${fromPath}`, 'NOT_FOUND');
    }

    assertNotSelfReferentialCopy(sourcePath, destinationPath, sourceNode);

    const existingDestination = await this.stat(destinationPath, ctx);

    if (existingDestination && !options.overwrite) {
      throw new AgentDocumentVfsError(`Path already exists: ${toPath}`, 'BAD_REQUEST');
    }

    if (sourceNode.type === 'directory') {
      await this.mkdir(destinationPath, ctx, { recursive: true });

      const children = await this.listChildrenForRecursiveCopy(sourcePath, ctx);
      for (const child of children) {
        await this.copy(child.path, `${destinationPath}/${child.name}`, ctx, options);
      }

      const copiedDirectory = await this.stat(destinationPath, ctx);

      if (!copiedDirectory) {
        throw new AgentDocumentVfsError(`Failed to reload copied path: ${toPath}`, 'BAD_REQUEST');
      }

      return copiedDirectory;
    }

    const { content } = await this.read(resolveReadablePath(sourcePath), ctx);
    return this.write(destinationPath, content, ctx, {
      createMode: options.overwrite ? 'if-missing' : 'always-new',
    });
  }

  /**
   * Soft-deletes a VFS path into agent-scoped trash.
   *
   * Use when:
   * - CLI `rm` should preserve restorable state
   *
   * Returns:
   * - Void
   */
  async delete(
    path: string,
    ctx: AgentDocumentVfsContext,
    options: AgentDocumentDeleteOptions = {},
  ): Promise<void> {
    const normalizedPath = normalizeAgentDocumentPath(path);

    if (isSkillPath(normalizedPath)) {
      await deleteMountedSkill(this.deps, normalizedPath, ctx);
      return;
    }

    const node = await resolveOrdinaryPath(this.deps, normalizedPath, ctx.agentId);

    if (!node) {
      throw new AgentDocumentVfsError(`Path not found: ${path}`, 'NOT_FOUND');
    }

    const subtree = await collectOrdinarySubtree(this.deps, node, ctx.agentId, true);

    if (node.fileType === DOCUMENT_FOLDER_TYPE && !options.recursive) {
      throw new AgentDocumentVfsError(
        `recursive=true is required for directory delete: ${path}`,
        'BAD_REQUEST',
      );
    }

    for (const item of subtree) {
      await this.agentDocumentModel.delete(
        item.id,
        item.fileType === DOCUMENT_FOLDER_TYPE ? 'recursive-delete' : 'user-delete',
      );
    }
  }

  /**
   * Lists agent-scoped trash entries.
   *
   * Use when:
   * - CLI `trash ls` needs a recovery-oriented view
   *
   * Returns:
   * - Flat trash entries with reconstructed paths
   */
  async listTrash(ctx: AgentDocumentVfsContext, path?: string): Promise<AgentDocumentTrashEntry[]> {
    return listTrash(this.deps, ctx, path);
  }

  /**
   * Restores a trash entry back into the live VFS tree.
   *
   * Use when:
   * - CLI `trash restore` needs to reactivate a soft-deleted path
   *
   * Returns:
   * - The restored node state
   */
  async restoreFromTrash(
    agentDocumentId: string,
    ctx: AgentDocumentVfsContext,
  ): Promise<AgentDocumentStats> {
    return restoreFromTrash(this.deps, agentDocumentId, ctx);
  }

  /**
   * Permanently removes a trash entry and its subtree.
   *
   * Use when:
   * - CLI `trash rm` should erase recoverable state
   *
   * Returns:
   * - Void
   */
  async deletePermanently(agentDocumentId: string, ctx: AgentDocumentVfsContext): Promise<void> {
    return deletePermanently(this.deps, agentDocumentId, ctx);
  }

  async restoreFromTrashByPath(
    path: string,
    ctx: AgentDocumentVfsContext,
  ): Promise<AgentDocumentStats> {
    return restoreFromTrashByPath(this.deps, path, ctx);
  }

  async deletePermanentlyByPath(path: string, ctx: AgentDocumentVfsContext): Promise<void> {
    return deletePermanentlyByPath(this.deps, path, ctx);
  }

  private async listChildrenForRecursiveCopy(
    path: string,
    ctx: AgentDocumentVfsContext,
  ): Promise<AgentDocumentNode[]> {
    const syntheticChildren = listSyntheticChildren(path);

    if (syntheticChildren) return syntheticChildren;

    if (isSkillPath(path)) {
      const nodes = await this.skillMount.list({
        agentId: ctx.agentId,
        path,
        topicId: ctx.topicId,
      });

      return nodes.map((node) => toMountedNode(node));
    }

    const parentNode = await resolveOrdinaryPath(this.deps, path, ctx.agentId);

    if (!parentNode) {
      throw new AgentDocumentVfsError(`Path not found: ${path}`, 'NOT_FOUND');
    }

    if (parentNode.fileType !== DOCUMENT_FOLDER_TYPE) {
      throw new AgentDocumentVfsError(`Path is not a directory: ${path}`, 'BAD_REQUEST');
    }

    const docs = await this.agentDocumentModel.listByParent(ctx.agentId, parentNode.documentId, {
      limit: MAX_RECURSIVE_COPY_CHILDREN + 1,
    });

    if (docs.length > MAX_RECURSIVE_COPY_CHILDREN) {
      throw new AgentDocumentVfsError(
        `Directory has too many direct children to copy safely: ${path}`,
        'BAD_REQUEST',
      );
    }

    return docs.map((doc) => toOrdinaryNode(doc, buildOrdinaryPath(path, doc.filename)));
  }
}
