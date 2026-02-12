import debug from 'debug';

import type { SkillMeta } from '../../providers/SkillContextProvider';

const log = debug('context-engine:skills-engine');

export interface SkillEngineOptions {
  skills: SkillMeta[];
}

/**
 * Skills Engine - Filters available skills by agent configuration
 *
 * Accepts a pre-merged array of SkillMeta from all sources (builtin, DB, etc.)
 * and provides filtering by agent's enabled plugin IDs.
 */
export class SkillEngine {
  private skills: Map<string, SkillMeta>;

  constructor(options: SkillEngineOptions) {
    this.skills = new Map(options.skills.map((s) => [s.identifier, s]));
    log('Initialized with %d skills: %o', this.skills.size, Array.from(this.skills.keys()));
  }

  /**
   * Filter skills by agent's enabled plugin IDs
   */
  getEnabledSkills(pluginIds: string[]): SkillMeta[] {
    return pluginIds.map((id) => this.skills.get(id)).filter((s): s is SkillMeta => !!s);
  }

  /**
   * Get all registered skills
   */
  getAllSkills(): SkillMeta[] {
    return Array.from(this.skills.values());
  }
}
