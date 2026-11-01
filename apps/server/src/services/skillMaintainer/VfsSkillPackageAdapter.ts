import { assertPackageRelativePath } from './pathSafety';
import type { ManagedSkillReference } from './types';

/**
 * Minimal VFS interface required by the skill package adapter.
 */
export interface VfsLike {
  /** Deletes one VFS path. */
  delete: (path: string) => Promise<void>;
  /** Lists one VFS directory path. */
  list: (path: string) => Promise<unknown>;
  /** Reads one VFS file path as text. */
  read: (path: string) => Promise<string>;
  /** Writes text content to one VFS file path. */
  write: (path: string, content: string) => Promise<void>;
}

/**
 * Routes package-relative skill file operations through a VFS-like backend.
 *
 * Use when:
 * - Skill services need path-safe file operations
 * - The concrete VFS backend may change independently
 *
 * Expects:
 * - Skill references contain a normalized root path
 *
 * Returns:
 * - VFS calls scoped under the skill package root
 */
export class VfsSkillPackageAdapter {
  constructor(private vfs: VfsLike) {}

  /**
   * Resolves a package-relative path under the skill root.
   *
   * Use when:
   * - Converting tool input paths into VFS paths
   * - Normalizing "." to the package root
   *
   * Expects:
   * - Non-root paths are package-relative and traversal-free
   *
   * Returns:
   * - A VFS path under the managed skill root
   */
  resolvePath(skill: ManagedSkillReference, path = '.') {
    const relativePath = path === '.' ? '' : assertPackageRelativePath(path);

    return relativePath ? `${skill.rootPath}/${relativePath}` : skill.rootPath;
  }

  async list(skill: ManagedSkillReference, path = '.') {
    return this.vfs.list(this.resolvePath(skill, path));
  }

  async read(skill: ManagedSkillReference, path: string) {
    return this.vfs.read(this.resolvePath(skill, path));
  }

  async write(skill: ManagedSkillReference, path: string, content: string) {
    if (!skill.writable) throw new Error('skill is not writable');

    await this.vfs.write(this.resolvePath(skill, path), content);
  }

  async delete(skill: ManagedSkillReference, path: string) {
    if (!skill.writable) throw new Error('skill is not writable');

    await this.vfs.delete(this.resolvePath(skill, path));
  }
}
