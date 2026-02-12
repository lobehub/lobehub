import type {
  CreateSkillInput,
  ImportGitHubInput,
  ImportUrlInput,
  ImportZipInput,
  SkillImportResult,
  SkillItem,
  SkillListItem,
  SkillResourceContent,
  SkillResourceTreeNode,
  SkillSource,
  UpdateSkillInput,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AgentSkillService {
  // ===== Create =====

  async createSkill(params: CreateSkillInput): Promise<SkillItem | undefined> {
    return lambdaClient.agentSkills.create.mutate(params);
  }

  // ===== Import =====

  async importFromGitHub(params: ImportGitHubInput): Promise<SkillImportResult | undefined> {
    return lambdaClient.agentSkills.importFromGitHub.mutate(params);
  }

  async importFromUrl(params: ImportUrlInput): Promise<SkillImportResult | undefined> {
    return lambdaClient.agentSkills.importFromUrl.mutate(params);
  }

  async importFromZip(params: ImportZipInput): Promise<SkillImportResult | undefined> {
    return lambdaClient.agentSkills.importFromZip.mutate(params);
  }

  // ===== Query =====

  async getById(id: string): Promise<SkillItem | undefined> {
    return lambdaClient.agentSkills.getById.query({ id });
  }

  async getZipUrl(id: string): Promise<{ name: string; url: string | null }> {
    return lambdaClient.agentSkills.getByIdWithZipUrl.query({ id });
  }

  async getByIdentifier(identifier: string): Promise<SkillItem | undefined> {
    return lambdaClient.agentSkills.getByIdentifier.query({ identifier });
  }

  async getByName(name: string): Promise<SkillItem | undefined> {
    return lambdaClient.agentSkills.getByName.query({ name });
  }

  async list(source?: SkillSource): Promise<{ data: SkillListItem[]; total: number }> {
    return lambdaClient.agentSkills.list.query(source ? { source } : undefined);
  }

  async search(query: string): Promise<{ data: SkillListItem[]; total: number }> {
    return lambdaClient.agentSkills.search.query({ query });
  }

  // ===== Resources =====

  async listResources(id: string, includeContent?: boolean): Promise<SkillResourceTreeNode[]> {
    return lambdaClient.agentSkills.listResources.query({ id, includeContent });
  }

  async readResource(id: string, path: string): Promise<SkillResourceContent> {
    return lambdaClient.agentSkills.readResource.query({ id, path });
  }

  // ===== Update =====

  async updateSkill(params: UpdateSkillInput): Promise<SkillItem> {
    return lambdaClient.agentSkills.update.mutate({
      content: params.content,
      id: params.id,
      manifest: params.manifest,
    });
  }

  // ===== Delete =====

  async deleteSkill(id: string): Promise<{ success: boolean }> {
    return lambdaClient.agentSkills.delete.mutate({ id });
  }
}

export const agentSkillService = new AgentSkillService();
