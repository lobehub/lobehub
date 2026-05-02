import { builtinSkills } from '@lobechat/builtin-skills';

import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';

import type { SkillMountProvider, SkillMountProviderRequest } from '../SkillMount';
import type { SkillMountNode } from '../types';
import {
  buildReadonlyNamespaceRootNode,
  listReadonlySkillChildren,
  listReadonlySkillRootNodes,
  resolveReadonlySkillNode,
} from './ProviderSkillsReadonly';

export class ProviderSkillsBuiltin implements SkillMountProvider {
  private readonly skills = filterBuiltinSkills(builtinSkills);

  async get(input: SkillMountProviderRequest): Promise<SkillMountNode> {
    if (!input.resolvedPath.skillName) {
      return buildReadonlyNamespaceRootNode('builtin');
    }

    const skill = this.skills.find((item) => item.identifier === input.resolvedPath.skillName);

    if (!skill) {
      throw new AgentDocumentVfsError(
        `Builtin skill "${input.resolvedPath.skillName}" not found`,
        'NOT_FOUND',
      );
    }

    if (input.resolvedPath.filePath === 'SKILL.md') {
      return resolveReadonlySkillNode({
        content: skill.content,
        namespace: 'builtin',
        path: input.resolvedPath.filePath,
        skill,
      });
    }

    const resource = input.resolvedPath.filePath
      ? skill.resources?.[input.resolvedPath.filePath]
      : undefined;

    return resolveReadonlySkillNode({
      content: resource?.content,
      namespace: 'builtin',
      path: input.resolvedPath.filePath,
      skill,
    });
  }

  async list(input: SkillMountProviderRequest): Promise<SkillMountNode[]> {
    if (!input.resolvedPath.skillName) {
      return listReadonlySkillRootNodes('builtin', this.skills);
    }

    const skill = this.skills.find((item) => item.identifier === input.resolvedPath.skillName);

    if (!skill) {
      throw new AgentDocumentVfsError(
        `Builtin skill "${input.resolvedPath.skillName}" not found`,
        'NOT_FOUND',
      );
    }

    return listReadonlySkillChildren('builtin', skill, input.resolvedPath.filePath);
  }
}
