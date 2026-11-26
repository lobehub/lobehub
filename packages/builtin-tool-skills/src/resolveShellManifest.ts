import { extractExecutionEnvironment, getShellSystemPrompt } from './systemRole';
import { SkillsApiName } from './types';

/**
 * APIs that only do something once a skill is loaded: `activateSkill` and
 * `readReference` resolve against the run's skill pool, and `execScript` runs
 * inside the directory of an activated skill.
 *
 * Listed by what needs a skill rather than by what is the shell, so an API
 * added to this tool later stays offered on a run without skills unless it is
 * added here on purpose.
 */
export const SKILL_BOUND_API_NAMES: ReadonlySet<string> = new Set<string>([
  SkillsApiName.activateSkill,
  SkillsApiName.execScript,
  SkillsApiName.readReference,
]);

/**
 * The part of the Skills tool that works with no skill available: the sandbox
 * shell (`runCommand`) and `exportFile`.
 *
 * Takes the manifest the run already resolved, so whatever the execution
 * environment or scope did to it (description preambles, hidden APIs, the
 * `<execution_environment>` fact) carries over. Returns `undefined` when
 * nothing is left, which is the case on a routed device and on an Agent Share
 * run: neither offers the sandbox shell through this tool.
 */
export const resolveSkillsShellManifest = <
  T extends { api: { name: string }[]; systemRole?: string },
>(
  manifest: T,
): T | undefined => {
  const api = manifest.api.filter(({ name }) => !SKILL_BOUND_API_NAMES.has(name));
  if (api.length === 0) return undefined;

  const offered = new Set(api.map(({ name }) => name));
  const role = getShellSystemPrompt({
    exportFile: offered.has(SkillsApiName.exportFile),
    runCommand: offered.has(SkillsApiName.runCommand),
  });

  return {
    ...manifest,
    api,
    systemRole: `${role}${extractExecutionEnvironment(manifest.systemRole)}`,
  };
};
