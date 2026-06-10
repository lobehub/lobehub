import type { SkillResourceMeta } from '@lobechat/types';

import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';

import { getUnifiedSkillNamespaceRootPath, type SkillNamespace } from '../path';
import type { SkillMountNode } from '../types';

type ReadonlySkillNamespace = Extract<
  SkillNamespace,
  'builtin' | 'installed-active' | 'installed-all'
>;

interface ReadonlySkillChild {
  name: string;
  path: string;
  size?: number;
  type: 'directory' | 'file';
}

interface ReadonlySkillEntry {
  content?: string | null;
  identifier: string;
  resources?: Record<string, SkillResourceMeta> | null;
}

const sortChildren = (children: ReadonlySkillChild[]) =>
  children.sort((left, right) => left.name.localeCompare(right.name));

const normalizeResourcePath = (path: string) => path.replace(/^\/+/, '').replace(/\/+$/, '');

const listResourceChildren = (
  resources: Record<string, SkillResourceMeta> | null | undefined,
  parentPath?: string,
): ReadonlySkillChild[] => {
  if (!resources) return [];

  const normalizedParentPath = parentPath ? normalizeResourcePath(parentPath) : undefined;
  const children = new Map<string, ReadonlySkillChild>();

  for (const resourcePath of Object.keys(resources)) {
    const normalizedResourcePath = normalizeResourcePath(resourcePath);
    const resource = resources[resourcePath] ?? resources[normalizedResourcePath];

    if (!normalizedResourcePath) continue;

    if (normalizedParentPath && !normalizedResourcePath.startsWith(`${normalizedParentPath}/`))
      continue;

    const remainder = normalizedParentPath
      ? normalizedResourcePath.slice(normalizedParentPath.length + 1)
      : normalizedResourcePath;

    if (!remainder) continue;

    const separatorIndex = remainder.indexOf('/');
    const childName = separatorIndex === -1 ? remainder : remainder.slice(0, separatorIndex);
    const childPath = normalizedParentPath ? `${normalizedParentPath}/${childName}` : childName;

    if (!children.has(childPath)) {
      children.set(childPath, {
        name: childName,
        path: childPath,
        ...(separatorIndex === -1 && resource ? { size: resource.size } : {}),
        type: separatorIndex === -1 ? 'file' : 'directory',
      });
    }
  }

  return sortChildren([...children.values()]);
};

const hasResourcePath = (
  resources: Record<string, SkillResourceMeta> | null | undefined,
  path: string,
): boolean => {
  if (!resources) return false;

  const normalizedPath = normalizeResourcePath(path);

  if (!normalizedPath) return false;
  if (normalizedPath in resources) return true;

  return Object.keys(resources).some((resourcePath) =>
    normalizeResourcePath(resourcePath).startsWith(`${normalizedPath}/`),
  );
};

export const buildReadonlyNamespaceRootNode = (
  namespace: ReadonlySkillNamespace,
): SkillMountNode => ({
  name: 'skills',
  namespace,
  path: getUnifiedSkillNamespaceRootPath(namespace),
  readOnly: true,
  type: 'directory',
});

export const buildReadonlySkillDirectoryNode = (
  namespace: ReadonlySkillNamespace,
  skillIdentifier: string,
): SkillMountNode => ({
  name: skillIdentifier,
  namespace,
  path: `${getUnifiedSkillNamespaceRootPath(namespace)}/${skillIdentifier}`,
  readOnly: true,
  type: 'directory',
});

export const buildReadonlySkillFileNode = ({
  content,
  filePath = 'SKILL.md',
  namespace,
  size,
  skillIdentifier,
}: {
  content?: string;
  filePath?: string;
  namespace: ReadonlySkillNamespace;
  size?: number;
  skillIdentifier: string;
}): SkillMountNode => ({
  ...(content !== undefined ? { content } : {}),
  ...(filePath.endsWith('.md') ? { contentType: 'text/markdown' as const } : {}),
  name: filePath.split('/').pop() || filePath,
  namespace,
  path: `${getUnifiedSkillNamespaceRootPath(namespace)}/${skillIdentifier}/${filePath}`,
  readOnly: true,
  ...((size ?? content?.length) !== undefined ? { size: size ?? content?.length } : {}),
  type: 'file',
});

export const buildReadonlySkillResourceDirectoryNode = ({
  namespace,
  resourcePath,
  skillIdentifier,
}: {
  namespace: ReadonlySkillNamespace;
  resourcePath: string;
  skillIdentifier: string;
}): SkillMountNode => ({
  name: resourcePath.split('/').pop() || resourcePath,
  namespace,
  path: `${getUnifiedSkillNamespaceRootPath(namespace)}/${skillIdentifier}/${resourcePath}`,
  readOnly: true,
  type: 'directory',
});

export const listReadonlySkillRootNodes = (
  namespace: ReadonlySkillNamespace,
  skills: ReadonlySkillEntry[],
) =>
  sortChildren(
    skills.map((skill) => ({
      name: skill.identifier,
      path: `${getUnifiedSkillNamespaceRootPath(namespace)}/${skill.identifier}`,
      type: 'directory' as const,
    })),
  ).map((skill) => buildReadonlySkillDirectoryNode(namespace, skill.name));

export const listReadonlySkillChildren = (
  namespace: ReadonlySkillNamespace,
  skill: ReadonlySkillEntry,
  directoryPath?: string,
) => {
  if (!directoryPath) {
    const children = [
      buildReadonlySkillFileNode({
        content: skill.content ?? '',
        namespace,
        skillIdentifier: skill.identifier,
      }),
      ...listResourceChildren(skill.resources).map((child) =>
        child.type === 'directory'
          ? buildReadonlySkillResourceDirectoryNode({
              namespace,
              resourcePath: child.path,
              skillIdentifier: skill.identifier,
            })
          : buildReadonlySkillFileNode({
              filePath: child.path,
              namespace,
              size: child.size,
              skillIdentifier: skill.identifier,
            }),
      ),
    ];

    return children.sort((left, right) => left.name.localeCompare(right.name));
  }

  if (directoryPath === 'SKILL.md') {
    return [
      buildReadonlySkillFileNode({
        content: skill.content ?? '',
        namespace,
        skillIdentifier: skill.identifier,
      }),
    ];
  }

  const children = listResourceChildren(skill.resources, directoryPath);

  if (children.length === 0) {
    if (!hasResourcePath(skill.resources, directoryPath)) {
      throw new AgentDocumentVfsError(
        `Skill resource path "${directoryPath}" not found`,
        'NOT_FOUND',
      );
    }

    return [
      buildReadonlySkillFileNode({
        filePath: directoryPath,
        namespace,
        size: skill.resources?.[directoryPath]?.size,
        skillIdentifier: skill.identifier,
      }),
    ];
  }

  return children.map((child) =>
    child.type === 'directory'
      ? buildReadonlySkillResourceDirectoryNode({
          namespace,
          resourcePath: child.path,
          skillIdentifier: skill.identifier,
        })
      : buildReadonlySkillFileNode({
          filePath: child.path,
          namespace,
          size: child.size,
          skillIdentifier: skill.identifier,
        }),
  );
};

export const resolveReadonlySkillNode = ({
  content,
  namespace,
  path,
  skill,
}: {
  content?: string;
  namespace: ReadonlySkillNamespace;
  path?: string;
  skill: ReadonlySkillEntry;
}): SkillMountNode => {
  if (!path) {
    return buildReadonlySkillDirectoryNode(namespace, skill.identifier);
  }

  if (path === 'SKILL.md') {
    return buildReadonlySkillFileNode({
      content: content ?? skill.content ?? '',
      namespace,
      skillIdentifier: skill.identifier,
    });
  }

  const children = listResourceChildren(skill.resources, path);

  if (children.length > 0) {
    return buildReadonlySkillResourceDirectoryNode({
      namespace,
      resourcePath: path,
      skillIdentifier: skill.identifier,
    });
  }

  if (!hasResourcePath(skill.resources, path)) {
    throw new AgentDocumentVfsError(`Skill resource path "${path}" not found`, 'NOT_FOUND');
  }

  return buildReadonlySkillFileNode({
    content,
    filePath: path,
    namespace,
    size: skill.resources?.[path]?.size,
    skillIdentifier: skill.identifier,
  });
};
