import { type OperationSkillSet, SkillEngine, type SkillMeta } from '@lobechat/context-engine';
import debug from 'debug';

import { type BuiltinSkillEnvironment, isBuiltinSkillEnabled } from './builtinSkillGate';

const log = debug('mecha:skillPool');

export type { BuiltinSkillEnvironment };
export { isBuiltinSkillEnabled, USER_HIDDEN_BUILTIN_SKILLS } from './builtinSkillGate';

/**
 * The skill sources of a run, in precedence order. A host that has no such
 * source leaves it out: the browser runtime scans no project directory and
 * mounts no agent-document bundles.
 */
export interface SkillPoolSources {
  /** Agent-document skill bundles, identified as `agent-skills:<filename>`. */
  agentSkills?: readonly SkillMeta[];
  builtin?: readonly SkillMeta[];
  /** The user's DB skills (personal and market installs). */
  db?: readonly SkillMeta[];
  /** SKILL.md files scanned from the run's project or device directory. */
  project?: readonly SkillMeta[];
}

export interface AssembleSkillPoolOptions {
  /** Explicit invocations (e.g. a composer selection or a task's plan). */
  activatedSkillIds?: readonly string[];
  /** Persisted enabled skills are discoverable by name and description only. */
  availableSkillIds?: readonly string[];
  /** Gates the device-only builtin skills. */
  canExecuteOnDevice?: boolean;
  /** Skills the agent explicitly disabled; neither listed nor activatable. */
  disabledIds?: readonly string[];
  /**
   * Identifiers a share configuration allows. `undefined` means the run is not
   * shared; an empty list collapses the pool to nothing.
   */
  shareAllowedIds?: readonly string[];
}

/**
 * The candidate pool `<available_skills>` is built from and `activateSkill`
 * resolves against. Precedence on a name collision is
 * project > db > agent-skills > builtin, disabled skills and anything a share
 * configuration withholds are dropped here rather than rule-gated later — the
 * resolver annotates its input rather than shrinking it, so a skill left in
 * the pool stays activatable.
 */
export const assembleSkillPool = (
  sources: SkillPoolSources,
  options: AssembleSkillPoolOptions = {},
): OperationSkillSet => {
  const activated = new Set(options.activatedSkillIds);
  const available = new Set([...(options.availableSkillIds ?? []), ...activated]);
  const ordered = [
    ...(sources.project ?? []),
    ...(sources.db ?? []),
    ...(sources.agentSkills ?? []),
    ...(sources.builtin ?? []),
  ];
  const disabled = new Set(options.disabledIds ?? []);
  const shareAllowed = options.shareAllowedIds ? new Set(options.shareAllowedIds) : undefined;
  const seenNames = new Set<string>();

  const skills = ordered.filter((skill) => {
    if (!available.has(skill.identifier) || disabled.has(skill.identifier)) return false;
    if (shareAllowed && !shareAllowed.has(skill.identifier)) return false;
    // Agent-document skills carry their prefix in `name`, so they can only
    // collide with each other; dedupe by name keeps one shape for the engine.
    if (seenNames.has(skill.name)) return false;
    seenNames.add(skill.name);
    return true;
  });

  log(
    'Assembled %d/%d skills (project=%d db=%d agent=%d builtin=%d)',
    skills.length,
    ordered.length,
    sources.project?.length ?? 0,
    sources.db?.length ?? 0,
    sources.agentSkills?.length ?? 0,
    sources.builtin?.length ?? 0,
  );

  const engine = new SkillEngine({
    enableChecker: (skill) =>
      isBuiltinSkillEnabled(skill.identifier, {
        canExecuteOnDevice: options.canExecuteOnDevice ?? false,
      }),
    skills: skills.map((skill) => {
      if (activated.has(skill.identifier)) return skill;
      const { content: _content, activated: _activated, ...metadata } = skill;
      return metadata;
    }),
  });
  return engine.generate([...activated]);
};
