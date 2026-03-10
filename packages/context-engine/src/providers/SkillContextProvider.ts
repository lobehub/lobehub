import { type SkillItem, skillsPrompts } from '@lobechat/prompts';
import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:SkillContextProvider');

/**
 * Lightweight skill metadata for context injection
 * Compatible with the SkillMeta that will be added in @lobechat/types (Phase 3.2)
 */
export interface SkillMeta {
  description: string;
  identifier: string;
  location?: string;
  name: string;
}

/**
 * Skill Context Provider Configuration
 */
export interface SkillContextProviderConfig {
  enabledSkills: SkillMeta[];
}

/**
 * Skill Context Provider
 * Injects lightweight skill metadata into the system prompt so the LLM knows
 * which skills are available and can invoke them via `runSkill`.
 */
export class SkillContextProvider extends BaseProvider {
  readonly name = 'SkillContextProvider';

  constructor(
    private config: SkillContextProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const { enabledSkills } = this.config;

    if (!enabledSkills || enabledSkills.length === 0) {
      log('No enabled skills, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const skills: SkillItem[] = enabledSkills.map((skill) => ({
      description: skill.description,
      identifier: skill.identifier,
      location: skill.location,
      name: skill.name,
    }));

    const skillContent = skillsPrompts(skills);

    if (!skillContent) {
      log('No skill content generated, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    this.injectSkillContext(clonedContext, skillContent);

    clonedContext.metadata.skillContext = {
      injected: true,
      skillsCount: enabledSkills.length,
    };

    log(`Skill context injected, skills count: ${enabledSkills.length}`);
    return this.markAsExecuted(clonedContext);
  }

  /**
   * Inject skill context into the system message
   */
  private injectSkillContext(context: PipelineContext, skillContent: string): void {
    const existingSystemMessage = context.messages.find((msg) => msg.role === 'system');

    if (existingSystemMessage) {
      existingSystemMessage.content = [existingSystemMessage.content, skillContent]
        .filter(Boolean)
        .join('\n\n');

      log(
        `Skill context merged to existing system message, final length: ${existingSystemMessage.content.length}`,
      );
    } else {
      context.messages.unshift({
        content: skillContent,
        id: `skill-context-${Date.now()}`,
        role: 'system' as const,
      } as any);
      log(`New skill system message created, content length: ${skillContent.length}`);
    }
  }
}
