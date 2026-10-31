import type { AgentDocumentVfsDeps } from './deps';
import { AgentDocumentVfsError } from './errors';
import { getUnifiedSkillNamespaceRootPath } from './mounts/skills/path';
import type { SkillMountNode } from './mounts/skills/types';
import { toMountedStats } from './nodes';
import { inferMountedSkillIdentity, resolveWritableMountedPath } from './skillPaths';
import type {
  AgentDocumentStats,
  AgentDocumentVfsContext,
  AgentDocumentWriteOptions,
} from './types';

export async function writeMountedSkill(
  deps: AgentDocumentVfsDeps,
  path: string,
  content: string,
  ctx: AgentDocumentVfsContext,
  createMode: NonNullable<AgentDocumentWriteOptions['createMode']>,
): Promise<AgentDocumentStats> {
  const existing = await deps.skillMount
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
    nextNode = await deps.skillMount.update({
      agentId: ctx.agentId,
      content,
      path,
      topicId: ctx.topicId,
    });
  } else {
    const { namespace, skillName } = inferMountedSkillIdentity(path);
    nextNode = await deps.skillMount.create({
      agentId: ctx.agentId,
      content,
      skillName,
      targetNamespace: namespace,
      topicId: ctx.topicId,
    });
  }

  return toMountedStats(nextNode);
}

export async function deleteMountedSkill(
  deps: AgentDocumentVfsDeps,
  path: string,
  ctx: AgentDocumentVfsContext,
) {
  const { namespace, skillName } = inferMountedSkillIdentity(resolveWritableMountedPath(path));

  if (namespace !== 'agent') {
    throw new AgentDocumentVfsError(`Path is read-only: ${path}`, 'FORBIDDEN');
  }

  await deps.skillMount.delete({
    agentId: ctx.agentId,
    path: `${getUnifiedSkillNamespaceRootPath(namespace)}/${skillName}/SKILL.md`,
    topicId: ctx.topicId,
  });
}
