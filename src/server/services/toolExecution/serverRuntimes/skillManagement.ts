import {
  type CreateSkillArgs,
  type GetSkillArgs,
  type ListSkillsArgs,
  type RenameSkillArgs,
  type ReplaceSkillIndexArgs,
  SkillMaintainerExecutionRuntime,
  SkillMaintainerIdentifier,
  type SkillMaintainerRuntimeService,
} from '@lobechat/builtin-tool-skill-maintainer';

import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { type ServerRuntimeRegistration } from './types';

/**
 * Creates the server runtime for hidden skill-management builtin tools.
 *
 * Use when:
 * - Tool execution needs to bind the package-level runtime to server persistence.
 * - Agent Signal workers need document-backed managed skill operations.
 *
 * Expects:
 * - `userId` and `serverDB` exist in tool execution context.
 * - Per-call runtime context supplies the target `agentId`.
 *
 * Returns:
 * - A runtime that delegates bundle/index invariants to {@link SkillManagementDocumentService}.
 */
export const skillManagementRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Skill Management execution');
    }

    const service = new SkillManagementDocumentService(context.serverDB, context.userId);

    const runtimeService: SkillMaintainerRuntimeService = {
      createSkill: (params: CreateSkillArgs & { agentId: string }) => service.createSkill(params),
      getSkill: (params: GetSkillArgs & { agentId: string }) => service.getSkill(params),
      listSkills: (params: ListSkillsArgs & { agentId: string }) => service.listSkills(params),
      renameSkill: (params: RenameSkillArgs & { agentId: string }) =>
        service.renameSkill({
          agentDocumentId: params.agentDocumentId,
          agentId: params.agentId,
          name: params.name,
          newName: params.newName,
          newTitle: params.newTitle,
          updateReason: params.reason,
        }),
      replaceSkillIndex: (params: ReplaceSkillIndexArgs & { agentId: string }) =>
        service.replaceSkillIndex({
          agentDocumentId: params.agentDocumentId,
          agentId: params.agentId,
          bodyMarkdown: params.bodyMarkdown,
          description: params.description,
          name: params.name,
          updateReason: params.reason,
        }),
    };

    return new SkillMaintainerExecutionRuntime(runtimeService);
  },
  identifier: SkillMaintainerIdentifier,
};
