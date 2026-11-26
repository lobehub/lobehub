import {
  extractActivatedSkillsFromMessages,
  hasHistoricalToolInvocation,
} from '@lobechat/agent-runtime';
import {
  getSystemPrompt as getActivatorSystemPrompt,
  LobeActivatorIdentifier,
  systemPrompt as activatorSystemPrompt,
} from '@lobechat/builtin-tool-activator';
import {
  resolveSkillsShellManifest,
  SKILL_BOUND_API_NAMES,
  SkillsIdentifier,
} from '@lobechat/builtin-tool-skills';
import { type LobeToolManifest, ToolNameResolver } from '@lobechat/context-engine';
import { type LobeAgentChatConfig, resolveToolMode, type UIChatMessage } from '@lobechat/types';

const toolNameResolver = new ToolNameResolver();

export interface SkillsToolDeferralRequest {
  chatConfig?: Pick<LobeAgentChatConfig, 'enableAgentMode' | 'toolMode'> | null;
  /**
   * Whether the run has a skill to offer. `undefined` means the host could not
   * establish it (its skill list failed to load), and the tool is left alone.
   */
  hasSkills: boolean | undefined;
  messages: UIChatMessage[];
}

/**
 * Whether a run may start without the skill APIs of `lobe-skills`.
 *
 * Only an Agent-mode run that is known to have no skill qualifies, and only
 * while the conversation has never used one: a provider rejects a history that
 * calls a function the request no longer declares, and a skill loaded earlier
 * still needs `readReference` / `execScript` after it was uninstalled. Earlier
 * shell calls do not count, since `runCommand` / `exportFile` stay declared.
 */
export const canDeferSkillsTool = ({
  chatConfig,
  hasSkills,
  messages,
}: SkillsToolDeferralRequest): boolean =>
  hasSkills === false &&
  resolveToolMode(chatConfig) === 'agent' &&
  !hasHistoricalToolInvocation(messages, SkillsIdentifier, SKILL_BOUND_API_NAMES) &&
  !extractActivatedSkillsFromMessages(messages)?.length;

export interface SkillsToolDeferral {
  /** `lobe-activator` without its `activateSkill` guidance; absent when its role is not the default one. */
  activatorManifest?: LobeToolManifest;
  /** The manifest to restore once a skill arrives (`OperationToolSet.deferredManifestMap`). */
  fullManifest: LobeToolManifest;
  /** Function-calling names that leave `tools[]`. */
  removedToolNames: ReadonlySet<string>;
  /**
   * What stays enabled: the sandbox shell and `exportFile`. Absent when the
   * resolved manifest offers neither (a routed device), and the whole tool
   * leaves the enabled set.
   */
  shellManifest?: LobeToolManifest;
}

/**
 * Work out what deferring `lobe-skills` does to a tool set, without touching
 * it. Both hosts apply the same plan to their own structures, so the server
 * and client runtimes cannot disagree on which APIs a run without skills keeps.
 */
export const planSkillsToolDeferral = (
  manifestMap: Record<string, LobeToolManifest>,
): SkillsToolDeferral | undefined => {
  const fullManifest = manifestMap[SkillsIdentifier];
  if (!fullManifest) return undefined;

  const shellManifest = resolveSkillsShellManifest(fullManifest);
  const keptApiNames = new Set(shellManifest?.api.map(({ name }) => name));
  const removedToolNames = new Set(
    fullManifest.api
      .filter(({ name }) => !keptApiNames.has(name))
      .map(({ name }) => toolNameResolver.generate(SkillsIdentifier, name, fullManifest.type)),
  );

  const activatorManifest = manifestMap[LobeActivatorIdentifier];

  return {
    activatorManifest:
      activatorManifest?.systemRole === activatorSystemPrompt
        ? { ...activatorManifest, systemRole: getActivatorSystemPrompt({ withSkills: false }) }
        : undefined,
    fullManifest,
    removedToolNames,
    shellManifest,
  };
};

export interface SkillsDeferrableToolSet {
  deferredManifestMap?: Record<string, LobeToolManifest>;
  enabledToolIds: string[];
  manifestMap: Record<string, LobeToolManifest>;
  tools?: Array<{ function?: { name?: string } }>;
}

const pruneInPlace = <T>(array: T[], keep: (item: T) => boolean) => {
  for (let index = array.length - 1; index >= 0; index -= 1) {
    if (!keep(array[index])) array.splice(index, 1);
  }
};

/**
 * Apply {@link planSkillsToolDeferral} to an operation tool set, in place: the
 * arrays and maps are the ones the host already handed to the rest of its
 * pipeline, which must see the same narrowed surface.
 */
export const applySkillsToolDeferral = (
  toolSet: SkillsDeferrableToolSet,
  deferral: SkillsToolDeferral,
): void => {
  const { activatorManifest, fullManifest, removedToolNames, shellManifest } = deferral;

  toolSet.deferredManifestMap = {
    ...toolSet.deferredManifestMap,
    [SkillsIdentifier]: fullManifest,
  };

  if (shellManifest) {
    toolSet.manifestMap[SkillsIdentifier] = shellManifest;
  } else {
    delete toolSet.manifestMap[SkillsIdentifier];
    pruneInPlace(toolSet.enabledToolIds, (id) => id !== SkillsIdentifier);
  }

  if (toolSet.tools) {
    pruneInPlace(toolSet.tools, (tool) => !removedToolNames.has(tool?.function?.name ?? ''));
  }

  if (activatorManifest) toolSet.manifestMap[LobeActivatorIdentifier] = activatorManifest;
};
