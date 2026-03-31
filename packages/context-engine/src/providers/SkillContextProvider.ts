import { type SkillItem, skillsPrompts } from '@lobechat/prompts';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    skillContext?: {
      injected: boolean;
      skillsCount: number;
    };
  }
}

const log = debug('context-engine:provider:SkillContextProvider');

/**
 * Lightweight skill metadata for context injection
 * Compatible with the SkillMeta that will be added in @lobechat/types (Phase 3.2)
 */
export interface SkillMeta {
  /**
   * When true, the skill's content is directly injected into the system prompt
   * instead of only appearing in the <available_skills> list.
   */
  activated?: boolean;
  /**
   * Full skill content to inject when activated.
   * Only used when `activated` is true.
   */
  content?: string;
  description: string;
  identifier: string;
  location?: string;
  name: string;
}

/**
 * Skill Context Provider Configuration
 */
export interface SkillContextProviderConfig {
  enabled?: boolean;
  enabledSkills?: SkillMeta[];
}

/**
 * Skill Context Provider
 * Injects lightweight skill metadata into the system prompt so the LLM knows
 * which skills are available and can invoke them via `runSkill`.
 */
export class SkillContextProvider extends BaseSystemRoleProvider {
  readonly name = 'SkillContextProvider';

  constructor(
    private config: SkillContextProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;

    const { enabledSkills } = this.config;

    if (!enabledSkills || enabledSkills.length === 0) {
      log('No enabled skills, skipping injection');
      return null;
    }

    // Separate activated skills (inject content directly) from available skills (list only)
    const activatedSkills = enabledSkills.filter((s) => s.activated && s.content);
    const availableSkills = enabledSkills.filter((s) => !s.activated);

    const contentParts: string[] = [];

    // Inject activated skill content directly into system prompt
    for (const skill of activatedSkills) {
      contentParts.push(skill.content!);
      log('Auto-activated skill: %s', skill.identifier);
    }

    // Generate <available_skills> list for non-activated skills
    if (availableSkills.length > 0) {
      const skills: SkillItem[] = availableSkills.map((skill) => ({
        description: skill.description,
        identifier: skill.identifier,
        location: skill.location,
        name: skill.name,
      }));

      const availableSkillsContent = skillsPrompts(skills);
      if (availableSkillsContent) {
        contentParts.push(availableSkillsContent);
      }
    }

    if (contentParts.length === 0) {
      log('No skill content generated, skipping injection');
      return null;
    }

    log(
      'Skill context prepared: %d activated, %d available',
      activatedSkills.length,
      availableSkills.length,
    );
    return contentParts.join('\n\n');
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.skillContext = {
      injected: true,
      skillsCount: this.config.enabledSkills?.length ?? 0,
    };
  }
}
