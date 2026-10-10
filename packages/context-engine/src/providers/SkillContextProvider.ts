import type { SkillSource } from '@lobechat/prompts';
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
  /**
   * Skill origin. `project` skills are discovered on the device filesystem and
   * loaded on demand via the readFile tool (see `location`).
   */
  source?: SkillSource;
}

/**
 * Skill Context Provider Configuration
 */
export interface SkillContextProviderConfig {
  enabled?: boolean;
  enabledSkills?: SkillMeta[];
}

/**
 * Select the activated skills whose full content gets injected into the system
 * prompt by SkillContextProvider.
 *
 * Exported so ActivationResultTrimProcessor can decide, with the exact same
 * predicate, whether an activateSkill tool result's full content is already
 * carried by the system prompt and can therefore be trimmed from history.
 */
export const selectActivatedSkills = (enabledSkills?: SkillMeta[]): SkillMeta[] =>
  (enabledSkills ?? []).filter((s) => s.activated && s.content);

/**
 * Skill Context Provider
 * Injects the full content of activated skills into the system prompt. The
 * `<available_skills>` list of not-yet-activated skills is injected separately
 * by SkillDiscoveryProvider, before the first user message.
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

    const activatedSkills = selectActivatedSkills(this.config.enabledSkills);

    if (activatedSkills.length === 0) {
      log('No activated skills, skipping injection');
      return null;
    }

    for (const skill of activatedSkills) {
      log('Auto-activated skill: %s', skill.identifier);
    }

    return activatedSkills.map((skill) => skill.content!).join('\n\n');
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.skillContext = {
      injected: true,
      skillsCount: selectActivatedSkills(this.config.enabledSkills).length,
    };
  }
}
