import { AgentAccess } from '@/database/models/agentDocuments';

import { AgentDocumentVfsError } from './errors';
import {
  getUnifiedSkillNamespaceParentPath,
  getUnifiedSkillNamespaceRootPath,
  isUnifiedSkillPath as isSkillPath,
  SKILL_NAMESPACES,
  type SkillNamespace,
} from './mounts/skills/path';
import type { SkillMountNode } from './mounts/skills/types';

export const inferMountedSkillIdentity = (path: string) => {
  for (const namespace of ['agent'] as const) {
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

export const getSkillNamespaceDirectory = (path: string): SkillNamespace | undefined => {
  for (const namespace of SKILL_NAMESPACES) {
    const parentPath = getUnifiedSkillNamespaceParentPath(namespace);
    const rootPath = getUnifiedSkillNamespaceRootPath(namespace);

    if (path === parentPath || path === rootPath) return namespace;
  }

  return undefined;
};

export const getSkillNamespaceCollectionParent = (path: string): SkillNamespace | undefined => {
  for (const namespace of SKILL_NAMESPACES) {
    if (path === getUnifiedSkillNamespaceParentPath(namespace)) return namespace;
  }

  return undefined;
};

export const buildSkillMountInfo = (namespace: SkillNamespace) => ({
  driver: 'skills',
  namespace,
  source: resolveSkillMountSource(namespace),
});

export const resolveSkillMountSource = (namespace: SkillNamespace) => {
  if (namespace === 'builtin') return 'builtin';
  if (namespace === 'installed-active' || namespace === 'installed-all') return 'installed';
  return 'documents';
};

export const SKILL_MOUNT_ACCESS = {
  'agent': AgentAccess.READ | AgentAccess.LIST | AgentAccess.WRITE | AgentAccess.DELETE,
  'builtin': AgentAccess.READ | AgentAccess.LIST,
  'installed-active': AgentAccess.READ | AgentAccess.LIST,
  'installed-all': AgentAccess.READ | AgentAccess.LIST,
} as const satisfies Record<SkillNamespace, AgentAccess>;

export const skillNodeToMode = (node: SkillMountNode): AgentAccess => {
  return SKILL_MOUNT_ACCESS[node.namespace];
};

export const resolveWritableMountedPath = (path: string) => {
  if (!isSkillPath(path)) return path;

  for (const namespace of ['agent', 'builtin', 'installed-active', 'installed-all'] as const) {
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

export const resolveReadablePath = (path: string) =>
  isSkillPath(path) ? resolveWritableMountedPath(path) : path;
