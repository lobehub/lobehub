import type { SkillItem, SkillListItem, SkillResourceMeta } from '@lobechat/types';

import type { AgentModel } from '@/database/models/agent';
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

interface InstalledActiveSkillModelLike {
  findAll: () => Promise<{ data: SkillListItem[]; total: number }>;
  findByIdentifier: (identifier: string) => Promise<SkillItem | undefined>;
}

interface ProviderSkillsInstalledActiveDeps {
  agentModel: Pick<AgentModel, 'getAgentConfigById'>;
  skillModel: InstalledActiveSkillModelLike;
  skillResourceService: Pick<SkillResourceService, 'readResource'>;
}

interface InstalledSkillProjection {
  content?: string | null;
  identifier: string;
  resources?: Record<string, SkillResourceMeta> | null;
}

export class ProviderSkillsInstalledActive implements SkillMountProvider {
  constructor(private readonly deps: ProviderSkillsInstalledActiveDeps) {}

  private async getEnabledIdentifiers(agentId: string) {
    const agent = await this.deps.agentModel.getAgentConfigById(agentId);
    return new Set(agent?.plugins ?? []);
  }

  private async findSkillByIdentifier(
    agentId: string,
    identifier: string,
  ): Promise<InstalledSkillProjection> {
    const enabledIdentifiers = await this.getEnabledIdentifiers(agentId);

    if (!enabledIdentifiers.has(identifier)) {
      throw new AgentDocumentVfsError(
        `Active installed skill "${identifier}" not found`,
        'NOT_FOUND',
      );
    }

    const skill = await this.deps.skillModel.findByIdentifier(identifier);

    if (!skill) {
      throw new AgentDocumentVfsError(
        `Active installed skill "${identifier}" not found`,
        'NOT_FOUND',
      );
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
      return buildReadonlyNamespaceRootNode('installed-active');
    }

    const skill = await this.findSkillByIdentifier(input.agentId, input.resolvedPath.skillName);

    if (!input.resolvedPath.filePath) {
      return resolveReadonlySkillNode({ namespace: 'installed-active', skill });
    }

    if (input.resolvedPath.filePath !== 'SKILL.md') {
      const node = resolveReadonlySkillNode({
        namespace: 'installed-active',
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
      namespace: 'installed-active',
      path: input.resolvedPath.filePath,
      skill,
    });
  }

  async list(input: SkillMountProviderRequest): Promise<SkillMountNode[]> {
    if (!input.resolvedPath.skillName) {
      const enabledIdentifiers = await this.getEnabledIdentifiers(input.agentId);
      const { data } = await this.deps.skillModel.findAll();

      return listReadonlySkillRootNodes(
        'installed-active',
        data
          .filter((skill) => enabledIdentifiers.has(skill.identifier))
          .map((skill) => ({ identifier: skill.identifier })),
      );
    }

    const skill = await this.findSkillByIdentifier(input.agentId, input.resolvedPath.skillName);

    return listReadonlySkillChildren('installed-active', skill, input.resolvedPath.filePath);
  }
}
