import { useState } from 'react';

import { useToolStore } from '@/store/tool';

/**
 * Removes a skill from the library by its row id. `failed` stays set after an
 * error until the next attempt, so the row can say the skill is still there.
 */
export const useUninstallLibrarySkill = (id: string) => {
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);

  const uninstall = async () => {
    setRemoving(true);
    setFailed(false);
    try {
      await deleteAgentSkill(id);
    } catch (cause) {
      console.warn('[Market] Failed to uninstall skill:', cause);
      setFailed(true);
    } finally {
      setRemoving(false);
    }
  };

  return { failed, removing, uninstall };
};
