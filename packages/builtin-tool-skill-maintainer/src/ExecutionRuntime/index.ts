import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  CreateSkillArgs,
  GetSkillArgs,
  ListSkillsArgs,
  RenameSkillArgs,
  ReplaceSkillIndexArgs,
} from '../types';

interface SkillMaintainerOperationContext {
  agentId?: string | null;
}

interface SkillDocumentRef {
  agentDocumentId: string;
  documentId: string;
  filename: string;
  title: string;
}

interface SkillSummary {
  bundle: SkillDocumentRef;
  description: string;
  index: SkillDocumentRef;
  name: string;
  title: string;
}

interface SkillDetail extends SkillSummary {
  content?: string;
  frontmatter: {
    description: string;
    name: string;
  };
}

/** Runtime service contract implemented by server-side skill-management adapters. */
export interface SkillMaintainerRuntimeService {
  createSkill: (params: CreateSkillArgs & { agentId: string }) => Promise<SkillDetail>;
  getSkill: (params: GetSkillArgs & { agentId: string }) => Promise<SkillDetail | undefined>;
  listSkills: (params: ListSkillsArgs & { agentId: string }) => Promise<SkillSummary[]>;
  renameSkill: (params: RenameSkillArgs & { agentId: string }) => Promise<SkillDetail | undefined>;
  replaceSkillIndex: (
    params: ReplaceSkillIndexArgs & { agentId: string },
  ) => Promise<SkillDetail | undefined>;
}

/**
 * Executes the hidden skill-maintainer builtin APIs.
 *
 * Use when:
 * - Server runtime registry needs a package-level wrapper around skill-management service calls.
 * - Agent Signal workers need stable tool outputs with agent document binding ids.
 *
 * Expects:
 * - The tool execution context provides `agentId`.
 * - The injected service owns bundle/index validation and persistence.
 *
 * Returns:
 * - Builtin runtime outputs whose `state` preserves `agentDocumentId` and backing `documentId`.
 */
export class SkillMaintainerExecutionRuntime {
  constructor(private service: SkillMaintainerRuntimeService) {}

  private resolveAgentId(context?: SkillMaintainerOperationContext) {
    if (!context?.agentId) return;
    return context.agentId;
  }

  private missingAgentIdResult(action: string): BuiltinServerRuntimeOutput {
    return {
      content: `Cannot ${action} managed skills without agentId context.`,
      success: false,
    };
  }

  private success(content: string, state?: Record<string, unknown>): BuiltinServerRuntimeOutput {
    return {
      content,
      ...(state && { state }),
      success: true,
    };
  }

  async listSkills(
    args: ListSkillsArgs,
    context?: SkillMaintainerOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) return this.missingAgentIdResult('list');

    const skills = await this.service.listSkills({ ...args, agentId });

    return this.success(JSON.stringify(skills), { skills });
  }

  async getSkill(
    args: GetSkillArgs,
    context?: SkillMaintainerOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) return this.missingAgentIdResult('read');

    const skill = await this.service.getSkill({ ...args, agentId });
    if (!skill) return { content: 'Managed skill not found.', success: false };

    return this.success(JSON.stringify(skill), { skill });
  }

  async createSkill(
    args: CreateSkillArgs,
    context?: SkillMaintainerOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) return this.missingAgentIdResult('create');

    const skill = await this.service.createSkill({ ...args, agentId });

    return this.success(
      `Created managed skill "${skill.name}" (${skill.bundle.agentDocumentId}).`,
      {
        skill,
      },
    );
  }

  async replaceSkillIndex(
    args: ReplaceSkillIndexArgs,
    context?: SkillMaintainerOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) return this.missingAgentIdResult('replace');

    const skill = await this.service.replaceSkillIndex({ ...args, agentId });
    if (!skill) return { content: 'Managed skill not found.', success: false };

    return this.success(`Replaced managed skill "${skill.name}" index.`, { skill });
  }

  async renameSkill(
    args: RenameSkillArgs,
    context?: SkillMaintainerOperationContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const agentId = this.resolveAgentId(context);
    if (!agentId) return this.missingAgentIdResult('rename');

    const skill = await this.service.renameSkill({ ...args, agentId });
    if (!skill) return { content: 'Managed skill not found.', success: false };

    return this.success(`Renamed managed skill "${skill.name}".`, { skill });
  }
}
