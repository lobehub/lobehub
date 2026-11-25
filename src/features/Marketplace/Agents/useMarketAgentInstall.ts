import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { installMarketplaceAgents } from '@/services/installMarketplaceAgents';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

/**
 * Whether I already have a copy of a Marketplace Agent, and the action that adds
 * one. Adding forks it the way onboarding does (`installMarketplaceAgents`, which
 * also installs the Market skills it ships with); the copy keeps the source as
 * `forkedFromIdentifier`, which is how "added" is known. In a workspace the copy
 * starts private, as the old Fork & Chat did, so teammates do not see it before
 * it has been vetted.
 */
export const useMarketAgentInstall = (id: string, name: string) => {
  const { t } = useTranslation('discover');
  const { allowed: canCreate } = usePermission('create_content');
  const { isAuthenticated, signIn } = useMarketAuth();
  const localId = useHomeStore(
    (s) =>
      homeAgentListSelectors.allAgents(s).find((agent) => agent.forkedFromIdentifier === id)?.id,
  );
  const added = !!localId;
  const [pending, setPending] = useState(false);

  /** Resolves `true` once I have a copy. */
  const add = useCallback(async () => {
    if (pending || added || !canCreate) return added;
    if (!isAuthenticated) {
      try {
        await signIn();
      } catch {
        return false;
      }
    }
    setPending(true);
    try {
      const result = await installMarketplaceAgents([id], { visibility: 'private' });
      if (result.installedAgentIds.length > 0 || result.skippedAgentIds.length > 0) {
        toast.success(t('marketplaceAgents.installed', { name }));
        return true;
      }
      toast.error(t('marketplaceAgents.addFailed'));
      return false;
    } catch (error) {
      console.error('[Marketplace] Failed to add an Agent', error);
      toast.error(t('marketplaceAgents.addFailed'));
      return false;
    } finally {
      setPending(false);
    }
  }, [added, canCreate, id, isAuthenticated, name, pending, signIn, t]);

  return { add, added, canCreate, localId, pending };
};
