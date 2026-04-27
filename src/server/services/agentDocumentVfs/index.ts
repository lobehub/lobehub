import type { LobeChatDatabase } from '@lobechat/database';

import {
  AgentAccess,
  type AgentDocument,
  AgentDocumentModel,
} from '@/database/models/agentDocuments';
import { DOCUMENT_FOLDER_TYPE } from '@/database/schemas';

import { createMarkdownEditorSnapshot } from '../agentDocuments/headlessEditor';
import { AgentDocumentVfsError } from './errors';
import { createSkillMount } from './mounts/skills/createSkillMount';
import {
  getUnifiedSkillNamespaceParentPath,
  getUnifiedSkillNamespaceRootPath,
  isUnifiedSkillPath as isSkillPath,
  SKILL_NAMESPACES,
  type SkillNamespace,
} from './mounts/skills/path';
import type { SkillMount } from './mounts/skills/SkillMount';
import type { SkillMountNode } from './mounts/skills/types';
import type {
  AgentDocumentListOptions,
  AgentDocumentNode,
  AgentDocumentReadResult,
  AgentDocumentStats,
  AgentDocumentTrashEntry,
} from './types';

const LOBE_PATH = './lobe';
const LOBE_SKILLS_PATH = './lobe/skills';
/**
 * Default cap for VFS directory reads while the public API still returns arrays.
 * Keep this near path constants because it is part of the VFS surface, not storage policy.
 */
const DEFAULT_LIST_LIMIT = 100;
/**
 * Maximum one-call VFS directory read size.
 * Prevents accidental wide-directory materialization from CLI or tool callers.
 */
const MAX_LIST_LIMIT = 500;
/**
 * Internal recursive copy safety cap.
 * This is intentionally separate from public listing pagination so `rename()` never drops children.
 */
const MAX_RECURSIVE_COPY_CHILDREN = 5000;

const SYNTHETIC_DIRECTORY_MODE = AgentAccess.LIST | AgentAccess.READ;

interface AgentDocumentVfsContext {
  agentId: string;
  topicId?: string;
}

interface AgentDocumentWriteOptions {
  createMode?: 'always-new' | 'if-missing' | 'must-exist';
}

interface AgentDocumentMkdirOptions {
  recursive?: boolean;
}

interface AgentDocumentDeleteOptions {
  recursive?: boolean;
}

interface AgentDocumentCopyOptions {
  overwrite?: boolean;
}

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

  constructor(db: LobeChatDatabase, userId: string) {
    this.agentDocumentModel = new AgentDocumentModel(db, userId);
    this.skillMount = createSkillMount(db, userId);
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
        this.listOrdinaryNodes(ctx.agentId, null, './', options),
        Promise.resolve(this.createSyntheticDirectoryNode(LOBE_PATH, 'lobe')),
      ]);

      return [...ordinaryNodes, lobeNode];
    }

    const syntheticChildren = this.listSyntheticChildren(normalizedPath);

    if (syntheticChildren) return syntheticChildren;

    if (isSkillPath(normalizedPath)) {
      const nodes = await this.skillMount.list({
        agentId: ctx.agentId,
        path: normalizedPath,
        topicId: ctx.topicId,
      });

      return applyListLimit(
        nodes.map((node) => this.toMountedNode(node)),
        options,
      );
    }

    const parentNode = await this.resolveOrdinaryPath(normalizedPath, ctx.agentId);

    if (!parentNode) {
      throw new AgentDocumentVfsError(`Path not found: ${normalizedPath}`, 'NOT_FOUND');
    }

    if (parentNode.fileType !== DOCUMENT_FOLDER_TYPE) {
      throw new AgentDocumentVfsError(`Path is not a directory: ${normalizedPath}`, 'BAD_REQUEST');
    }

    return this.listOrdinaryNodes(ctx.agentId, parentNode.documentId, normalizedPath, options);
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
    const syntheticNode = this.getSyntheticNode(normalizedPath);

    if (syntheticNode) return syntheticNode;

    if (isSkillPath(normalizedPath)) {
      const node = await this.skillMount.get({
        agentId: ctx.agentId,
        path: normalizedPath,
        topicId: ctx.topicId,
      });

      return this.toMountedStats(node);
    }

    const ordinaryNode = await this.resolveOrdinaryPath(normalizedPath, ctx.agentId);
    return ordinaryNode ? this.toOrdinaryStats(ordinaryNode, normalizedPath) : undefined;
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
  async read(path: string, ctx: AgentDocumentVfsContext): Promise<AgentDocumentReadResult> {
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
        content: node.content ?? '',
        contentType: node.contentType,
        path: node.path,
      };
    }

    const node = await this.resolveOrdinaryPath(normalizedPath, ctx.agentId);

    if (!node) {
      throw new AgentDocumentVfsError(`Path not found: ${path}`, 'NOT_FOUND');
    }

    if (node.fileType === DOCUMENT_FOLDER_TYPE) {
      throw new AgentDocumentVfsError(`Path is not a file: ${path}`, 'BAD_REQUEST');
    }

    return {
      content: node.content,
      contentType: 'text/markdown',
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
      return this.writeMountedSkill(normalizedPath, content, ctx, createMode);
    }

    return this.writeOrdinaryDocument(normalizedPath, content, ctx, createMode);
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
        await this.assertUniqueOrdinarySibling(ctx.agentId, parentId, segment, existing.id);

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

      await this.assertNoOrdinarySiblingConflict(ctx.agentId, parentId, segment);

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

    return this.toOrdinaryStats(currentNode, normalizedPath);
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
      return this.renameOrdinaryPath(sourcePath, destinationPath, ctx, options);
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
      await this.deleteMountedSkill(normalizedPath, ctx);
      return;
    }

    const node = await this.resolveOrdinaryPath(normalizedPath, ctx.agentId);

    if (!node) {
      throw new AgentDocumentVfsError(`Path not found: ${path}`, 'NOT_FOUND');
    }

    const subtree = await this.collectOrdinarySubtree(node, ctx.agentId, true);

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
   * Promotes a topic-scoped skill into an agent-scoped mounted skill.
   *
   * Use when:
   * - Router APIs need the old promote behavior through the unified VFS path surface
   *
   * Returns:
   * - The promoted mounted skill metadata
   */
  async promoteSkill(path: string, ctx: AgentDocumentVfsContext, options: { targetName?: string }) {
    const normalizedPath = normalizeAgentDocumentPath(path);

    if (!isSkillPath(normalizedPath)) {
      throw new AgentDocumentVfsError(`Path is not a skill mount path: ${path}`, 'BAD_REQUEST');
    }

    if (!ctx.topicId) {
      throw new AgentDocumentVfsError(
        'Topic ID is required to promote a topic skill',
        'BAD_REQUEST',
      );
    }

    const nextNode = await this.skillMount.promote({
      agentId: ctx.agentId,
      path: normalizedPath,
      targetName: options.targetName,
      topicId: ctx.topicId,
    });

    return this.toMountedStats(nextNode);
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
    const deletedDocs = await this.agentDocumentModel.listDeletedByAgent(ctx.agentId);
    const entries = await Promise.all(
      deletedDocs.map(async (doc) => {
        const path = await this.buildOrdinaryPathFromNode(doc, ctx.agentId);
        return {
          ...this.toOrdinaryStats(doc, path),
          deleteReason: doc.deleteReason,
          deletedAt: doc.deletedAt ?? new Date(0),
        } satisfies AgentDocumentTrashEntry;
      }),
    );

    if (!path) return entries;

    const normalizedPath = normalizeAgentDocumentPath(path);
    return entries.filter(
      (entry) => entry.path === normalizedPath || entry.path.startsWith(`${normalizedPath}/`),
    );
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
    const root = await this.agentDocumentModel.findByIdWithOptions(agentDocumentId, {
      includeDeleted: true,
    });

    if (!root?.deletedAt) {
      throw new AgentDocumentVfsError(`Trash entry not found: ${agentDocumentId}`, 'NOT_FOUND');
    }

    const ancestors = await this.collectDeletedAncestors(root, ctx.agentId);
    const subtree = await this.collectOrdinarySubtree(root, ctx.agentId, true);
    await this.assertNoRestoreConflicts([...ancestors, ...subtree], ctx.agentId);

    for (const ancestor of ancestors.reverse()) {
      if (ancestor.deletedAt) {
        await this.agentDocumentModel.restore(ancestor.id);
      }
    }

    for (const item of subtree) {
      if (item.deletedAt) {
        await this.agentDocumentModel.restore(item.id);
      }
    }

    const restored = await this.resolveOrdinaryPath(
      await this.buildOrdinaryPathFromNode(root, ctx.agentId),
      ctx.agentId,
    );

    if (!restored) {
      throw new AgentDocumentVfsError(`Failed to restore path: ${agentDocumentId}`, 'BAD_REQUEST');
    }

    return this.toOrdinaryStats(
      restored,
      await this.buildOrdinaryPathFromNode(restored, ctx.agentId),
    );
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
    const root = await this.agentDocumentModel.findByIdWithOptions(agentDocumentId, {
      includeDeleted: true,
    });

    if (!root?.deletedAt) {
      throw new AgentDocumentVfsError(`Trash entry not found: ${agentDocumentId}`, 'NOT_FOUND');
    }

    const subtree = await this.collectOrdinarySubtree(root, ctx.agentId, true);

    for (const item of subtree.reverse()) {
      await this.agentDocumentModel.permanentlyDelete(item.id);
    }
  }

  async restoreFromTrashByPath(
    path: string,
    ctx: AgentDocumentVfsContext,
  ): Promise<AgentDocumentStats> {
    const entry = await this.findTrashEntryByPath(path, ctx);

    if (!entry) {
      throw new AgentDocumentVfsError(`Trash entry not found: ${path}`, 'NOT_FOUND');
    }

    return this.restoreFromTrash(entry.agentDocumentId!, ctx);
  }

  async deletePermanentlyByPath(path: string, ctx: AgentDocumentVfsContext): Promise<void> {
    const entry = await this.findTrashEntryByPath(path, ctx);

    if (!entry) {
      throw new AgentDocumentVfsError(`Trash entry not found: ${path}`, 'NOT_FOUND');
    }

    await this.deletePermanently(entry.agentDocumentId!, ctx);
  }

  private async listOrdinaryNodes(
    agentId: string,
    parentId: string | null,
    parentPath: string,
    options: AgentDocumentListOptions = {},
  ): Promise<AgentDocumentNode[]> {
    const docs = await this.agentDocumentModel.listByParent(agentId, parentId, {
      cursor: options.cursor,
      limit: normalizeListLimit(options.limit),
    });
    return applyListLimit(
      docs.map((doc) => this.toOrdinaryNode(doc, buildOrdinaryPath(parentPath, doc.filename))),
      options,
    );
  }

  private async resolveOrdinaryPath(
    path: string,
    agentId: string,
  ): Promise<AgentDocument | undefined> {
    return this.resolveOrdinaryPathWithOptions(path, agentId);
  }

  private async resolveOrdinaryPathWithOptions(
    path: string,
    agentId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<AgentDocument | undefined> {
    if (path === './') return undefined;

    const segments = splitAgentDocumentPath(path);
    let parentId: string | null = null;
    let current: AgentDocument | undefined;

    for (const segment of segments) {
      const candidates = await this.agentDocumentModel.listByParentAndFilename(
        agentId,
        parentId,
        segment,
        {
          ...options,
          limit: 2,
        },
      );

      if (candidates.length > 1) {
        throw new AgentDocumentVfsError(`Duplicate VFS path segment: ${segment}`, 'CONFLICT');
      }

      current = candidates[0];
      if (!current) return undefined;
      parentId = current.documentId;
    }

    return current;
  }

  private async listChildrenForRecursiveCopy(
    path: string,
    ctx: AgentDocumentVfsContext,
  ): Promise<AgentDocumentNode[]> {
    const syntheticChildren = this.listSyntheticChildren(path);

    if (syntheticChildren) return syntheticChildren;

    if (isSkillPath(path)) {
      const nodes = await this.skillMount.list({
        agentId: ctx.agentId,
        path,
        topicId: ctx.topicId,
      });

      return nodes.map((node) => this.toMountedNode(node));
    }

    const parentNode = await this.resolveOrdinaryPath(path, ctx.agentId);

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

    return docs.map((doc) => this.toOrdinaryNode(doc, buildOrdinaryPath(path, doc.filename)));
  }

  private async writeMountedSkill(
    path: string,
    content: string,
    ctx: AgentDocumentVfsContext,
    createMode: NonNullable<AgentDocumentWriteOptions['createMode']>,
  ): Promise<AgentDocumentStats> {
    const existing = await this.skillMount
      .get({
        agentId: ctx.agentId,
        path,
        topicId: ctx.topicId,
      })
      .catch((error) => {
        if (error instanceof AgentDocumentVfsError && error.code === 'NOT_FOUND') return undefined;
        throw error;
      });

    if (!existing && createMode === 'must-exist') {
      throw new AgentDocumentVfsError(`Path not found: ${path}`, 'NOT_FOUND');
    }

    if (existing && createMode === 'always-new') {
      throw new AgentDocumentVfsError(`Path already exists: ${path}`, 'CONFLICT');
    }

    let nextNode: SkillMountNode;

    if (existing) {
      nextNode = await this.skillMount.update({
        agentId: ctx.agentId,
        content,
        path,
        topicId: ctx.topicId,
      });
    } else {
      const { namespace, skillName } = inferMountedSkillIdentity(path);
      nextNode = await this.skillMount.create({
        agentId: ctx.agentId,
        content,
        skillName,
        targetNamespace: namespace,
        topicId: ctx.topicId,
      });
    }

    return this.toMountedStats(nextNode);
  }

  private async writeOrdinaryDocument(
    path: string,
    content: string,
    ctx: AgentDocumentVfsContext,
    createMode: NonNullable<AgentDocumentWriteOptions['createMode']>,
  ): Promise<AgentDocumentStats> {
    if (path === './' || path === LOBE_PATH || path.startsWith(`${LOBE_PATH}/`)) {
      throw new AgentDocumentVfsError(`Cannot write reserved path: ${path}`, 'BAD_REQUEST');
    }

    const existing = await this.resolveOrdinaryPath(path, ctx.agentId);

    if (existing) {
      if (existing.fileType === DOCUMENT_FOLDER_TYPE) {
        throw new AgentDocumentVfsError(`Path is not a file: ${path}`, 'BAD_REQUEST');
      }

      await this.assertUniqueOrdinarySibling(
        ctx.agentId,
        existing.parentId,
        existing.filename,
        existing.id,
      );

      if (createMode === 'always-new') {
        throw new AgentDocumentVfsError(`Path already exists: ${path}`, 'BAD_REQUEST');
      }

      const snapshot = await createMarkdownEditorSnapshot(content);
      await this.agentDocumentModel.update(existing.id, {
        content: snapshot.content,
        editorData: snapshot.editorData,
      });

      const updated = await this.resolveOrdinaryPath(path, ctx.agentId);

      if (!updated) {
        throw new AgentDocumentVfsError(`Failed to reload updated path: ${path}`, 'BAD_REQUEST');
      }

      return this.toOrdinaryStats(updated, path);
    }

    if (createMode === 'must-exist') {
      throw new AgentDocumentVfsError(`Path not found: ${path}`, 'NOT_FOUND');
    }

    const segments = splitAgentDocumentPath(path);
    const filename = segments.at(-1);

    if (!filename) {
      throw new AgentDocumentVfsError(`Invalid VFS path: ${path}`, 'BAD_REQUEST');
    }

    const parentPath = segments.length === 1 ? './' : `./${segments.slice(0, -1).join('/')}`;
    const parentNode =
      parentPath === './' ? undefined : await this.resolveOrdinaryPath(parentPath, ctx.agentId);

    if (parentPath !== './' && !parentNode) {
      throw new AgentDocumentVfsError(`Parent path not found: ${parentPath}`, 'BAD_REQUEST');
    }

    if (parentNode && parentNode.fileType !== DOCUMENT_FOLDER_TYPE) {
      throw new AgentDocumentVfsError(
        `Parent path is not a directory: ${parentPath}`,
        'BAD_REQUEST',
      );
    }

    await this.assertNoOrdinarySiblingConflict(
      ctx.agentId,
      parentNode?.documentId ?? null,
      filename,
    );

    const snapshot = await createMarkdownEditorSnapshot(content);
    const created = await this.agentDocumentModel.create(ctx.agentId, filename, snapshot.content, {
      editorData: snapshot.editorData,
      parentId: parentNode?.documentId ?? null,
      title: filename,
    });

    return this.toOrdinaryStats(created, path);
  }

  private async renameOrdinaryPath(
    sourcePath: string,
    destinationPath: string,
    ctx: AgentDocumentVfsContext,
    options: AgentDocumentCopyOptions,
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

    const sourceNode = await this.resolveOrdinaryPath(sourcePath, ctx.agentId);

    if (!sourceNode) {
      throw new AgentDocumentVfsError(`Path not found: ${sourcePath}`, 'NOT_FOUND');
    }

    const existingDestination = await this.resolveOrdinaryPath(destinationPath, ctx.agentId);

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

      await this.delete(destinationPath, ctx);
    }

    const segments = splitAgentDocumentPath(destinationPath);
    const filename = segments.at(-1);

    if (!filename) {
      throw new AgentDocumentVfsError(`Invalid VFS path: ${destinationPath}`, 'BAD_REQUEST');
    }

    const parentPath = segments.length === 1 ? './' : `./${segments.slice(0, -1).join('/')}`;
    const parentNode =
      parentPath === './' ? undefined : await this.resolveOrdinaryPath(parentPath, ctx.agentId);

    if (parentPath !== './' && !parentNode) {
      throw new AgentDocumentVfsError(`Parent path not found: ${parentPath}`, 'BAD_REQUEST');
    }

    if (parentNode && parentNode.fileType !== DOCUMENT_FOLDER_TYPE) {
      throw new AgentDocumentVfsError(
        `Parent path is not a directory: ${parentPath}`,
        'BAD_REQUEST',
      );
    }

    const parentId = parentNode?.documentId ?? null;
    await this.assertNoOrdinarySiblingConflict(ctx.agentId, parentId, filename);

    const moved = await this.agentDocumentModel.movePath(sourceNode.id, {
      filename,
      parentId,
    });

    if (!moved) {
      throw new AgentDocumentVfsError(`Failed to rename path: ${sourcePath}`, 'BAD_REQUEST');
    }

    return this.toOrdinaryStats(moved, destinationPath);
  }

  private toOrdinaryNode(doc: AgentDocument, path: string): AgentDocumentNode {
    return {
      agentDocumentId: doc.id,
      createdAt: doc.createdAt,
      documentId: doc.documentId,
      id: doc.id,
      mode: doc.accessSelf,
      mount: {
        driver: 'agent-documents',
        source: 'documents',
      },
      name: doc.filename,
      path,
      size: doc.content.length,
      type: doc.fileType === DOCUMENT_FOLDER_TYPE ? 'directory' : 'file',
      updatedAt: doc.updatedAt,
    };
  }

  private toOrdinaryStats(doc: AgentDocument, path: string): AgentDocumentStats {
    return {
      ...this.toOrdinaryNode(doc, path),
      contentType: doc.fileType === DOCUMENT_FOLDER_TYPE ? undefined : 'text/markdown',
      deleteReason: doc.deleteReason,
      deletedAt: doc.deletedAt,
      metadata: doc.metadata ?? undefined,
    };
  }

  private toMountedNode(node: SkillMountNode): AgentDocumentNode {
    return {
      id: `skills:${node.namespace}:${node.path}`,
      mode: skillNodeToMode(node),
      mount: {
        driver: 'skills',
        namespace: node.namespace,
        source: resolveSkillMountSource(node.namespace),
      },
      name: node.name,
      path: node.path,
      size: node.size ?? (node.type === 'file' ? node.content?.length : undefined),
      type: node.type,
    };
  }

  private toMountedStats(node: SkillMountNode): AgentDocumentStats {
    return {
      ...this.toMountedNode(node),
      contentType: node.contentType,
    };
  }

  private createSyntheticDirectoryNode(path: string, name: string): AgentDocumentNode {
    return {
      id: `synthetic:${path}`,
      mode: SYNTHETIC_DIRECTORY_MODE,
      mount: {
        driver: 'synthetic',
        source: 'virtual',
      },
      name,
      path,
      type: 'directory',
    };
  }

  private getSyntheticNode(path: string): AgentDocumentStats | undefined {
    if (path === './') return { ...this.createSyntheticDirectoryNode('./', '') };
    if (path === LOBE_PATH) return { ...this.createSyntheticDirectoryNode(LOBE_PATH, 'lobe') };
    if (path === LOBE_SKILLS_PATH) {
      return { ...this.createSyntheticDirectoryNode(LOBE_SKILLS_PATH, 'skills') };
    }

    const namespace = getSkillNamespaceDirectory(path);

    if (namespace) {
      const name = path.split('/').at(-1)!;
      return {
        ...this.createSyntheticDirectoryNode(path, name),
        mount: buildSkillMountInfo(namespace),
      };
    }

    return undefined;
  }

  private listSyntheticChildren(path: string): AgentDocumentNode[] | undefined {
    if (path === LOBE_PATH) {
      return [this.createSyntheticDirectoryNode(LOBE_SKILLS_PATH, 'skills')];
    }

    if (path === LOBE_SKILLS_PATH) {
      return [
        this.createSyntheticDirectoryNode('./lobe/skills/builtin', 'builtin'),
        this.createSyntheticDirectoryNode('./lobe/skills/installed', 'installed'),
        this.createSyntheticDirectoryNode('./lobe/skills/agent', 'agent'),
        this.createSyntheticDirectoryNode('./lobe/skills/agent-topic', 'agent-topic'),
      ];
    }

    if (path === './lobe/skills/installed') {
      return [
        this.createSyntheticDirectoryNode('./lobe/skills/installed/all', 'all'),
        this.createSyntheticDirectoryNode('./lobe/skills/installed/active', 'active'),
      ];
    }

    const namespace = getSkillNamespaceCollectionParent(path);

    if (namespace) {
      return [
        {
          ...this.createSyntheticDirectoryNode(
            getUnifiedSkillNamespaceRootPath(namespace),
            'skills',
          ),
          mount: buildSkillMountInfo(namespace),
        },
      ];
    }

    return undefined;
  }

  private async collectOrdinarySubtree(
    root: AgentDocument,
    agentId: string,
    includeDeleted: boolean,
  ): Promise<AgentDocument[]> {
    const nodes = [root];

    if (root.fileType !== DOCUMENT_FOLDER_TYPE) return nodes;

    const queue: AgentDocument[] = [root];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = await this.agentDocumentModel.listByParent(agentId, current.documentId, {
        includeDeleted,
      });

      for (const child of children) {
        nodes.push(child);
        if (child.fileType === DOCUMENT_FOLDER_TYPE) {
          queue.push(child);
        }
      }
    }

    return nodes;
  }

  private async collectDeletedAncestors(
    node: AgentDocument,
    agentId: string,
  ): Promise<AgentDocument[]> {
    const ancestors: AgentDocument[] = [];
    let parentId = node.parentId;

    while (parentId) {
      const parent = await this.agentDocumentModel.findByDocumentId(agentId, parentId, {
        includeDeleted: true,
      });

      if (!parent) break;
      ancestors.push(parent);
      parentId = parent.parentId;
    }

    return ancestors;
  }

  private async assertNoRestoreConflicts(nodes: AgentDocument[], agentId: string): Promise<void> {
    for (const node of nodes) {
      if (!node.deletedAt) continue;

      const liveNode = await this.agentDocumentModel.findByParentAndFilename(
        agentId,
        node.parentId,
        node.filename,
      );

      if (liveNode && liveNode.id !== node.id) {
        throw new AgentDocumentVfsError(
          `Cannot restore over live path: ${node.filename}`,
          'CONFLICT',
        );
      }

      await this.assertUniqueOrdinarySibling(agentId, node.parentId, node.filename, node.id);
    }
  }

  private async assertNoOrdinarySiblingConflict(
    agentId: string,
    parentId: string | null,
    filename: string,
  ): Promise<void> {
    const conflicts = await this.agentDocumentModel.listByParentAndFilename(
      agentId,
      parentId,
      filename,
      {
        limit: 1,
      },
    );

    if (conflicts.length > 0) {
      throw new AgentDocumentVfsError(`Path already exists: ${filename}`, 'CONFLICT');
    }
  }

  private async assertUniqueOrdinarySibling(
    agentId: string,
    parentId: string | null,
    filename: string,
    expectedAgentDocumentId: string,
  ): Promise<void> {
    const conflicts = await this.agentDocumentModel.listByParentAndFilename(
      agentId,
      parentId,
      filename,
      {
        limit: 2,
      },
    );
    const unexpectedConflicts = conflicts.filter((node) => node.id !== expectedAgentDocumentId);

    if (unexpectedConflicts.length > 0) {
      throw new AgentDocumentVfsError(`Duplicate VFS path segment: ${filename}`, 'CONFLICT');
    }
  }

  private async buildOrdinaryPathFromNode(node: AgentDocument, agentId: string): Promise<string> {
    const segments = [node.filename];
    let parentId = node.parentId;

    while (parentId) {
      const parent = await this.agentDocumentModel.findByDocumentId(agentId, parentId, {
        includeDeleted: true,
      });

      if (!parent) break;
      segments.unshift(parent.filename);
      parentId = parent.parentId;
    }

    return `./${segments.join('/')}`;
  }

  private async deleteMountedSkill(path: string, ctx: AgentDocumentVfsContext) {
    const { namespace, skillName } = inferMountedSkillIdentity(resolveWritableMountedPath(path));

    if (namespace !== 'agent' && namespace !== 'agent-topic') {
      throw new AgentDocumentVfsError(`Path is read-only: ${path}`, 'FORBIDDEN');
    }

    await this.skillMount.delete({
      agentId: ctx.agentId,
      path: `${getUnifiedSkillNamespaceRootPath(namespace)}/${skillName}/SKILL.md`,
      topicId: ctx.topicId,
    });
  }

  private async findTrashEntryByPath(path: string, ctx: AgentDocumentVfsContext) {
    const normalizedPath = normalizeAgentDocumentPath(path);
    const entries = await this.listTrash(ctx);
    return entries.find((entry) => entry.path === normalizedPath);
  }
}

const normalizeAgentDocumentPath = (path: string) => {
  const raw = path.trim();
  const withDot =
    raw === '/' ? './' : raw.startsWith('./') ? raw : raw.startsWith('/') ? `.${raw}` : `./${raw}`;
  const collapsed = withDot.replaceAll(/\/+/g, '/');

  if (collapsed.includes('/./') || collapsed.includes('/../') || collapsed.endsWith('/..')) {
    throw new AgentDocumentVfsError(`Invalid VFS path: ${path}`, 'BAD_REQUEST');
  }

  const normalized = collapsed === './' ? './' : collapsed.replace(/\/$/, '');
  return normalized;
};

const splitAgentDocumentPath = (path: string) =>
  path.replace(/^\.\//, '').split('/').filter(Boolean);

const buildOrdinaryPath = (parentPath: string, filename: string) =>
  parentPath === './' ? `./${filename}` : `${parentPath}/${filename}`;

const normalizeListLimit = (limit?: number) => {
  if (limit === undefined) return DEFAULT_LIST_LIMIT;

  // Clamp caller-provided limits so path APIs stay bounded even when invoked by tools.
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIST_LIMIT);
};

const applyListLimit = <T>(items: T[], options: AgentDocumentListOptions) =>
  items.slice(0, normalizeListLimit(options.limit));

const isDescendantPath = (parentPath: string, childPath: string) =>
  childPath !== parentPath && childPath.startsWith(`${parentPath}/`);

const assertNotSelfReferentialCopy = (
  sourcePath: string,
  destinationPath: string,
  sourceNode: AgentDocumentStats,
) => {
  if (sourcePath === destinationPath) {
    throw new AgentDocumentVfsError(`Cannot copy path onto itself: ${sourcePath}`, 'BAD_REQUEST');
  }

  if (sourceNode.type === 'directory' && isDescendantPath(sourcePath, destinationPath)) {
    throw new AgentDocumentVfsError(
      `Cannot copy directory into its own subtree: ${sourcePath} -> ${destinationPath}`,
      'BAD_REQUEST',
    );
  }
};

const inferMountedSkillIdentity = (path: string) => {
  for (const namespace of ['agent', 'agent-topic'] as const) {
    const prefix = getUnifiedSkillNamespaceRootPath(namespace);

    if (path === prefix || !path.startsWith(`${prefix}/`)) continue;

    const relativePath = path.slice(prefix.length + 1);
    const [skillName] = relativePath.split('/');

    if (!skillName) {
      throw new AgentDocumentVfsError(
        `Expected a skill path, but received namespace root: ${path}`,
        'BAD_REQUEST',
      );
    }

    return { namespace, skillName };
  }

  throw new AgentDocumentVfsError(`Namespace is not writable: ${path}`, 'FORBIDDEN');
};

const getSkillNamespaceDirectory = (path: string): SkillNamespace | undefined => {
  for (const namespace of SKILL_NAMESPACES) {
    const parentPath = getUnifiedSkillNamespaceParentPath(namespace);
    const rootPath = getUnifiedSkillNamespaceRootPath(namespace);

    if (path === parentPath || path === rootPath) return namespace;
  }

  return undefined;
};

const getSkillNamespaceCollectionParent = (path: string): SkillNamespace | undefined => {
  for (const namespace of SKILL_NAMESPACES) {
    if (path === getUnifiedSkillNamespaceParentPath(namespace)) return namespace;
  }

  return undefined;
};

const buildSkillMountInfo = (namespace: SkillNamespace) => ({
  driver: 'skills',
  namespace,
  source: resolveSkillMountSource(namespace),
});

const resolveSkillMountSource = (namespace: SkillNamespace) => {
  if (namespace === 'builtin') return 'builtin';
  if (namespace === 'installed-active' || namespace === 'installed-all') return 'installed';
  return 'documents';
};

const SKILL_MOUNT_ACCESS = {
  'agent': AgentAccess.READ | AgentAccess.LIST | AgentAccess.WRITE | AgentAccess.DELETE,
  'agent-topic':
    AgentAccess.READ |
    AgentAccess.LIST |
    AgentAccess.WRITE |
    AgentAccess.DELETE |
    AgentAccess.EXECUTE,
  'builtin': AgentAccess.READ | AgentAccess.LIST,
  'installed-active': AgentAccess.READ | AgentAccess.LIST,
  'installed-all': AgentAccess.READ | AgentAccess.LIST,
} as const satisfies Record<SkillNamespace, AgentAccess>;

const skillNodeToMode = (node: SkillMountNode): AgentAccess => {
  return SKILL_MOUNT_ACCESS[node.namespace];
};

const resolveWritableMountedPath = (path: string) => {
  if (!isSkillPath(path)) return path;

  for (const namespace of [
    'agent',
    'agent-topic',
    'builtin',
    'installed-active',
    'installed-all',
  ] as const) {
    const prefix = getUnifiedSkillNamespaceRootPath(namespace);

    if (path === prefix) {
      throw new AgentDocumentVfsError(
        `Expected a skill path, but received namespace root: ${path}`,
        'BAD_REQUEST',
      );
    }

    if (!path.startsWith(`${prefix}/`)) continue;

    const relativePath = path.slice(prefix.length + 1);
    const [skillName, ...rest] = relativePath.split('/');

    if (!skillName) {
      throw new AgentDocumentVfsError(
        `Expected a skill path, but received namespace root: ${path}`,
        'BAD_REQUEST',
      );
    }

    if (rest.length === 0) {
      return `${prefix}/${skillName}/SKILL.md`;
    }

    return path;
  }

  return path;
};

const resolveReadablePath = (path: string) =>
  isSkillPath(path) ? resolveWritableMountedPath(path) : path;
