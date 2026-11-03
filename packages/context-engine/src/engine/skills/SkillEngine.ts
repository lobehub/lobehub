import debug from 'debug';

import type { SkillMeta } from '../../providers/SkillContextProvider';
import type { OperationSkillSet, SkillEnableChecker, SkillEngineOptions } from './types';

const log = debug('context-engine:skills-engine');

/**
 * Skills Engine - Assembles the operation-level skill set.
 *
 * Analogous to ToolsEngine for tools. Accepts raw skills from all sources
 * (builtin, DB, etc.) and an optional enableChecker, then produces an
 * OperationSkillSet with environment-appropriate skills filtered in.
 */
export class SkillEngine {
  private skills: Map<string, SkillMeta>;
  private enableChecker?: SkillEnableChecker;

  constructor(options: SkillEngineOptions) {
    this.enableChecker = options.enableChecker;
    this.skills = new Map(options.skills.map((s) => [s.identifier, s]));
    log('Initialized with %d skills: %o', this.skills.size, Array.from(this.skills.keys()));
  }

  /**
   * Assemble the OperationSkillSet for an agent execution.
   *
   * Filters skills through enableChecker and pairs the result with
   * the agent's enabled plugin IDs for downstream SkillResolver consumption.
   *
   * @param pluginIds  Plugin IDs enabled on the agent
   */
  generate(pluginIds: string[]): OperationSkillSet {
    const allSkills = Array.from(this.skills.values());

    const filteredSkills = this.enableChecker
      ? allSkills.filter((skill) => {
          const enabled = this.enableChecker!(skill);
          if (!enabled) {
            log('Skill filtered out by enableChecker: %s', skill.identifier);
          }
          return enabled;
        })
      : allSkills;

    log(
      'Generated OperationSkillSet: %d/%d skills, pluginIds=%o',
      filteredSkills.length,
      allSkills.length,
      pluginIds,
    );

    return {
      enabledPluginIds: pluginIds,
      skills: filteredSkills,
    };
  }
}
