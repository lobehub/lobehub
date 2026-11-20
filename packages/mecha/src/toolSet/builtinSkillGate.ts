import {
  AgentBrowserIdentifier,
  ArtifactsIdentifier,
  LobeHubIdentifier,
} from '@lobechat/builtin-skills/manifests';
import { type LobeAgentChatConfig, resolveToolMode } from '@lobechat/types';

// #23412 changed an absent builtin skill preference from Auto to off. Older
// clients did not write an entry even when a user explicitly chose Auto.
const SKILL_OPT_IN_SINCE = Date.parse('2026-11-18T15:53:51Z');
export const legacyBuiltinSkillIds: readonly string[] = [
  AgentBrowserIdentifier,
  ArtifactsIdentifier,
  LobeHubIdentifier,
];

const noImplicitSkills: readonly string[] = [];

export type SkillDiscoveryChatConfig = Pick<
  LobeAgentChatConfig,
  'enableAgentMode' | 'skillActivateMode' | 'toolMode'
>;

export const getImplicitBuiltinSkillIds = (
  createdAt: Date | string | undefined,
  chatConfig: SkillDiscoveryChatConfig | null | undefined,
): readonly string[] =>
  createdAt &&
  new Date(createdAt).getTime() < SKILL_OPT_IN_SINCE &&
  chatConfig?.skillActivateMode !== 'manual' &&
  resolveToolMode(chatConfig) === 'agent'
    ? legacyBuiltinSkillIds
    : noImplicitSkills;

/** Builtin skills that only work where the run can execute commands on a device. */
const DEVICE_ONLY_BUILTIN_SKILLS = new Set<string>([AgentBrowserIdentifier]);

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
  if (DEVICE_ONLY_BUILTIN_SKILLS.has(skillId)) return environment.canExecuteOnDevice;
  return true;
};
