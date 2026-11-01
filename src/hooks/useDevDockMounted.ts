import { useServerConfigStore } from '@/store/serverConfig';
import { shouldMountDevDock, useDevDockUnlocked } from '@/utils/devDockUnlock';

export const useDevDockMounted = () => {
  const canAccess = useServerConfigStore((s) => s.canAccessDevDock);
  const unlocked = useDevDockUnlocked();

  return shouldMountDevDock({ canAccess, isProduction: import.meta.env.PROD, unlocked });
};
