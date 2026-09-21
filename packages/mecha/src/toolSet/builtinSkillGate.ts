import { AgentBrowserIdentifier } from '@lobechat/builtin-skills/manifests';

/** Builtin skills that only work where the run can execute commands on a device. */
const DEVICE_ONLY_BUILTIN_SKILLS = new Set<string>([AgentBrowserIdentifier]);

/** Builtin skills the product drives itself; never listed to the user or the model. */
export const USER_HIDDEN_BUILTIN_SKILLS = new Set<string>(['task']);

export interface BuiltinSkillEnvironment {
  /**
   * The run can execute commands on a device: the desktop app is itself that
   * device, a gateway run needs a device-capable execution plan. The
   * compile-time `isDesktop` constant is meaningless on the server.
   */
  canExecuteOnDevice: boolean;
}

/**
 * Whether a builtin skill may be listed and activated for this run.
 *
 * Kept in its own module, free of every other tool import, so the leaf callers
 * that only need this gate (store slices, settings UI) do not pull the whole
 * runtime graph in behind it.
 */
export const isBuiltinSkillEnabled = (
  skillId: string,
  environment: BuiltinSkillEnvironment,
): boolean => {
  if (USER_HIDDEN_BUILTIN_SKILLS.has(skillId)) return false;
  if (DEVICE_ONLY_BUILTIN_SKILLS.has(skillId)) return environment.canExecuteOnDevice;
  return true;
};
