import type { ExecScriptParams } from '@lobechat/builtin-tool-skills';

import { agentSkillService } from '@/services/skill';

import { localFileService } from './localFileService';

type SkillConfig = ExecScriptParams['config'];

class DesktopSkillRuntimeService {
  private async prepareSkillDirectoryForSkill(skill?: {
    id: string;
    name: string;
    zipFileHash?: string | null;
  }) {
    if (!skill?.zipFileHash) return undefined;

    const zipUrl = await agentSkillService.getZipUrl(skill.id);
    if (!zipUrl.url) return undefined;

    const prepared = await localFileService.prepareSkillDirectory({
      url: zipUrl.url,
      zipHash: skill.zipFileHash,
    });

    if (!prepared.success) {
      throw new Error(prepared.error || `Failed to prepare local skill directory: ${skill.name}`);
    }

    return prepared.extractedDir;
  }

  private async resolveSkill(params: { id?: string; name?: string }) {
    const skillById = params.id ? await agentSkillService.getById(params.id) : undefined;
    return skillById ?? (params.name ? await agentSkillService.getByName(params.name) : undefined);
  }

  async resolveExecutionDirectory(config?: SkillConfig): Promise<string | undefined> {
    const skill = await this.resolveSkill({ id: config?.id, name: config?.name });
    return this.prepareSkillDirectoryForSkill(skill);
  }

  async resolveReferenceFullPath(params: {
    path: string;
    skillId?: string;
    skillName?: string;
  }): Promise<string | undefined> {
    const skill = await this.resolveSkill({ id: params.skillId, name: params.skillName });
    if (!skill?.zipFileHash) return undefined;

    const zipUrl = await agentSkillService.getZipUrl(skill.id);
    if (!zipUrl.url) return undefined;

    const resolved = await localFileService.resolveSkillResourcePath({
      path: params.path,
      url: zipUrl.url,
      zipHash: skill.zipFileHash,
    });

    if (!resolved.success) {
      throw new Error(
        resolved.error || `Failed to resolve skill resource path: ${skill.name}/${params.path}`,
      );
    }

    return resolved.fullPath;
  }
}

export const desktopSkillRuntimeService = new DesktopSkillRuntimeService();
