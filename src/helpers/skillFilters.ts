import { isDesktop } from '@lobechat/const';
// Imported from the leaf module rather than the package barrel: this helper
// is used by store slices and settings UI, which must not pull the whole
// agent-runtime graph in behind a two-line gate.
import {
  type BuiltinSkillEnvironment,
  isBuiltinSkillEnabled,
  USER_HIDDEN_BUILTIN_SKILLS,
} from '@lobechat/mecha/builtinSkillGate';
import { type BuiltinSkill } from '@lobechat/types';

export type BuiltinSkillFilterContext = BuiltinSkillEnvironment;

// The rule lives in `@lobechat/mecha` so both hosts gate the device-only
// builtin skills the same way. On the client the desktop app is itself the
// execution device; server callers must derive it from the run's execution
// plan, since the compile-time `isDesktop` constant is always false there.
const DEFAULT_CONTEXT: BuiltinSkillFilterContext = { canExecuteOnDevice: isDesktop };

export const shouldEnableBuiltinSkill = (
  skillId: string,
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): boolean =>
  isBuiltinSkillEnabled(skillId, {
    canExecuteOnDevice: context.canExecuteOnDevice ?? DEFAULT_CONTEXT.canExecuteOnDevice,
  });

export const filterBuiltinSkills = <T extends Pick<BuiltinSkill, 'identifier'>>(
  skills: T[],
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): T[] => skills.filter((skill) => shouldEnableBuiltinSkill(skill.identifier, context));

export { USER_HIDDEN_BUILTIN_SKILLS };
