import { useCallback, useState } from 'react';

import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

/**
 * Whether a market skill is installed in the active scope, and the actions that
 * install and uninstall it. Installing only adds it to the skill library;
 * assistants still enable it themselves.
 */
export const useMarketSkillInstall = (identifier: string) => {
  // The library row, whose id the uninstall needs.
  const installedId = useToolStore(
    (s) =>
      agentSkillsSelectors.getMarketAgentSkills(s).find((skill) => skill.identifier === identifier)
        ?.id,
  );
  const installed = !!installedId;
  const refreshAgentSkills = useToolStore((s) => s.refreshAgentSkills);
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  /** Resolves `true` once the skill is in the library. */
  const install = useCallback(async () => {
    if (pending || installed) return installed;
    setPending(true);
    setError(false);
    try {
      await agentSkillService.importFromMarket(identifier);
      await refreshAgentSkills();
      return true;
    } catch (cause) {
      console.warn('[Market] Failed to install skill:', cause);
      setError(true);
      return false;
    } finally {
      setPending(false);
    }
  }, [identifier, installed, pending, refreshAgentSkills]);

  const uninstall = useCallback(async () => {
    if (pending || !installedId) return;
    setPending(true);
    setError(false);
    try {
      await deleteAgentSkill(installedId);
    } catch (cause) {
      console.warn('[Market] Failed to uninstall skill:', cause);
      setError(true);
    } finally {
      setPending(false);
    }
  }, [deleteAgentSkill, installedId, pending]);

  return { error, install, installed, pending, uninstall };
};
