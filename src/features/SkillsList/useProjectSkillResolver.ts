import { isDesktop } from '@lobechat/const';
import { useCallback } from 'react';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useProjectSkills } from './useProjectSkills';

export interface ResolvedProjectSkill {
  description?: string;
  name: string;
  /**
   * Opens the skill's `SKILL.md` in the right-hand portal. Present whenever the
   * skill resolves — local reads go over IPC, a bound device over RPC (matches
   * the Files tab / working-sidebar behavior).
   */
  open?: () => void;
}

/**
 * Resolve a filesystem-skill tag (by its bare `name`) against the active
 * session's live skill list so an inline tag can show the skill's own description
 * and open its `SKILL.md`.
 *
 * Resolution is name-based on purpose: the persisted `<skill name label />` wire
 * format carries no path/category, and the same lookup works both in the editor
 * (composition) and in sent messages. A tag that no longer resolves (skill
 * removed, or a different working directory) simply degrades to a plain,
 * non-clickable chip.
 *
 * Mirrors `useSlashActionItems`' cwd + device resolution so the tag opens
 * exactly the skill the slash menu would have inserted.
 */
export const useProjectSkillResolver = (
  agentId?: string,
): ((name: string) => ResolvedProjectSkill | undefined) => {
  // Unified cwd: topic > agent's per-device choice > device default > home.
  const workingDirectory = useEffectiveWorkingDirectory(agentId);

  // Resolve the EFFECTIVE target, then treat it as remote only when it lands on
  // `device` with a bound device — same coercion the slash menu / sidebar use so
  // a hetero "This device" run opened on web still resolves.
  const agencyConfig = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgencyConfigById(agentId)(s) : undefined,
  );
  const isHetero = useAgentStore((s) =>
    agentId ? agentByIdSelectors.isAgentHeterogeneousById(agentId)(s) : false,
  );
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
  const effectiveTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
  });
  const isDeviceMode = effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId;
  const remoteDeviceId = isDeviceMode ? agencyConfig.boundDeviceId : undefined;

  // Local desktop reads over IPC; a bound device reads over RPC. Shares the SWR
  // key with the slash menu / sidebar, so this adds no extra fetch.
  const projectSkillsEnabled = (isDesktop || !!remoteDeviceId) && !!workingDirectory;
  const { items, onOpenSkill } = useProjectSkills(
    projectSkillsEnabled ? workingDirectory : undefined,
    remoteDeviceId,
  );

  return useCallback(
    (name: string) => {
      const item = items.find((skill) => skill.name === name);
      if (!item) return undefined;
      return {
        description: item.description,
        name: item.name,
        // Preview opens in every mode now — onOpenSkill reads over IPC locally
        // and over RPC for a bound device (like the Files tab).
        open: () => onOpenSkill(item),
      };
    },
    [items, onOpenSkill],
  );
};
