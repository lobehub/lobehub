import { type SkillItem, skillsPrompts } from '@lobechat/prompts';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';
import type { SkillMeta } from './SkillContextProvider';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    skillDiscoveryContext?: {
      injected: boolean;
      skillsCount: number;
    };
  }
}

const log = debug('context-engine:provider:SkillDiscoveryProvider');

export interface SkillDiscoveryProviderConfig {
  enabled?: boolean;
  enabledSkills?: SkillMeta[];
}

const selectAvailableSkills = (enabledSkills?: SkillMeta[]): SkillMeta[] =>
  (enabledSkills ?? []).filter((s) => !s.activated);

/**
 * Skill Discovery Provider
 * Injects the `<available_skills>` list of not-yet-activated skills before the
 * first user message, alongside the `<available_tools>` list, so the model can
 * load one on demand via `activateSkill`. Keeping this per-user list out of the
 * system prompt leaves the system prompt stable across installs and uninstalls.
 */
export class SkillDiscoveryProvider extends BaseFirstUserContentProvider {
  readonly name = 'SkillDiscoveryProvider';

  constructor(
    private config: SkillDiscoveryProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;

    const availableSkills = selectAvailableSkills(this.config.enabledSkills);

    if (availableSkills.length === 0) {
      log('No available skills, skipping injection');
      return null;
    }

    const skills: SkillItem[] = availableSkills.map((skill) => ({
      description: skill.description,
      identifier: skill.identifier,
      location: skill.location,
      name: skill.name,
      source: skill.source,
    }));

    const content = skillsPrompts(skills);

    if (!content) return null;

    log('Skill discovery content prepared, skills count: %d', availableSkills.length);
    return content;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);

    const skillsCount = selectAvailableSkills(this.config.enabledSkills).length;
    if (this.config.enabled !== false && skillsCount > 0) {
      result.metadata.skillDiscoveryContext = { injected: true, skillsCount };
    }

    return result;
  }
}
