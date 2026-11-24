import { useState } from 'react';

import { useToolStore } from '@/store/tool';

/** Removes a skill from the library by its row id, with the row's pending flag. */
export const useUninstallLibrarySkill = (id: string) => {
  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const [removing, setRemoving] = useState(false);

  const uninstall = async () => {
    setRemoving(true);
    try {
      await deleteAgentSkill(id);
    } catch (cause) {
      console.warn('[Market] Failed to uninstall skill:', cause);
    } finally {
      setRemoving(false);
    }
  };

  return { removing, uninstall };
};
