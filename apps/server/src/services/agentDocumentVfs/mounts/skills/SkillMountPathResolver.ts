import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';

import { getUnifiedSkillNamespaceRootPath, SKILL_NAMESPACES, type SkillNamespace } from './path';
import type { ResolvedSkillMountPath } from './types';

const SKILL_MOUNT_PREFIXES = SKILL_NAMESPACES.map(
  (namespace) => [getUnifiedSkillNamespaceRootPath(namespace), namespace] as const,
) satisfies ReadonlyArray<readonly [prefix: string, namespace: SkillNamespace]>;

/**
 * Resolves strict skill VFS paths into mount path parts.
 *
 * Use when:
 * - Skill mounts need to dispatch unified `./lobe/skills/...` paths to namespace providers
 * - Routers need invalid skill VFS paths to surface as BAD_REQUEST instead of generic failures
 *
 * Expects:
 * - Paths use one of the configured strict skill namespace prefixes
 *
 * Returns:
 * - Parsed namespace, skill name, and optional file path parts
 */
export class SkillMountPathResolver {
  static isSkillPath(path: string) {
    try {
      SkillMountPathResolver.resolve(path);
      return true;
    } catch {
      return false;
    }
  }

  static resolve(path: string): ResolvedSkillMountPath {
    const match = SKILL_MOUNT_PREFIXES.find(
      ([prefix]) => path === prefix || path.startsWith(`${prefix}/`),
    );

    if (!match) {
      throw new AgentDocumentVfsError('Not a skill VFS path', 'BAD_REQUEST');
    }

    const [prefix, namespace] = match;
    const rawRelativePath = path.slice(prefix.length);

    if (rawRelativePath.startsWith('//')) {
      throw new AgentDocumentVfsError('Not a skill VFS path', 'BAD_REQUEST');
    }

    const relativePath = rawRelativePath.replace(/^\/+/, '').replace(/\/+$/, '');

    if (
      relativePath.includes('//') ||
      relativePath.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new AgentDocumentVfsError('Not a skill VFS path', 'BAD_REQUEST');
    }

    if (!relativePath) {
      return {
        namespace,
        relativePath,
      };
    }

    const separatorIndex = relativePath.indexOf('/');

    if (separatorIndex < 0) {
      return {
        namespace,
        relativePath,
        skillName: relativePath,
      };
    }

    return {
      namespace,
      relativePath,
      skillName: relativePath.slice(0, separatorIndex),
      ...(separatorIndex < relativePath.length - 1
        ? { filePath: relativePath.slice(separatorIndex + 1) }
        : {}),
    };
  }
}
