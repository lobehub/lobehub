import type { SkillItem, SkillListItem, SkillResourceMeta } from '@lobechat/types';

import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';
import type { SkillResourceService } from '@/server/services/skill/resource';

import type { SkillMountProvider, SkillMountProviderRequest } from '../SkillMount';
import type { SkillMountNode } from '../types';
import {
  buildReadonlyNamespaceRootNode,
  listReadonlySkillChildren,
  listReadonlySkillRootNodes,
  resolveReadonlySkillNode,
} from './ProviderSkillsReadonly';

interface InstalledSkillModelLike {
  findAll: () => Promise<{ data: SkillListItem[]; total: number }>;
  findByIdentifier: (identifier: string) => Promise<SkillItem | undefined>;
}

interface ProviderSkillsInstalledAllDeps {
  skillModel: InstalledSkillModelLike;
  skillResourceService: Pick<SkillResourceService, 'readResource'>;
}

interface InstalledSkillProjection {
  content?: string | null;
  identifier: string;
  resources?: Record<string, SkillResourceMeta> | null;
}

export class ProviderSkillsInstalledAll implements SkillMountProvider {
  constructor(private readonly deps: ProviderSkillsInstalledAllDeps) {}

  private async findSkillByIdentifier(identifier: string): Promise<InstalledSkillProjection> {
    const skill = await this.deps.skillModel.findByIdentifier(identifier);

    if (!skill) {
      throw new AgentDocumentVfsError(`Installed skill "${identifier}" not found`, 'NOT_FOUND');
    }

    return skill;
  }

  private async readResource(skill: InstalledSkillProjection, path: string) {
    if (!skill.resources) {
      throw new AgentDocumentVfsError(
        `Installed skill "${skill.identifier}" has no resources`,
        'NOT_FOUND',
      );
    }

    const resource = await this.deps.skillResourceService.readResource(skill.resources, path);

    return resource.content;
  }

  async get(input: SkillMountProviderRequest): Promise<SkillMountNode> {
    if (!input.resolvedPath.skillName) {
      return buildReadonlyNamespaceRootNode('installed-all');
    }

    const skill = await this.findSkillByIdentifier(input.resolvedPath.skillName);

    if (!input.resolvedPath.filePath) {
      return resolveReadonlySkillNode({ namespace: 'installed-all', skill });
    }

    if (input.resolvedPath.filePath !== 'SKILL.md') {
      const node = resolveReadonlySkillNode({
        namespace: 'installed-all',
        path: input.resolvedPath.filePath,
        skill,
      });

      if (node.type === 'directory') {
        return node;
      }
    }

    const content =
      input.resolvedPath.filePath === 'SKILL.md'
        ? (skill.content ?? '')
        : await this.readResource(skill, input.resolvedPath.filePath);

    return resolveReadonlySkillNode({
      content,
      namespace: 'installed-all',
      path: input.resolvedPath.filePath,
      skill,
    });
  }

  async list(input: SkillMountProviderRequest): Promise<SkillMountNode[]> {
    if (!input.resolvedPath.skillName) {
      const { data } = await this.deps.skillModel.findAll();

      return listReadonlySkillRootNodes(
        'installed-all',
        data.map((skill) => ({ identifier: skill.identifier })),
      );
    }

    const skill = await this.findSkillByIdentifier(input.resolvedPath.skillName);

    return listReadonlySkillChildren('installed-all', skill, input.resolvedPath.filePath);
  }
}
