import { randomAgentName } from '@lobechat/const';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

/**
 * One-click naming for an agent that never got a personal name — agents created
 * before names existed, or through a path that doesn't seed one (REST, group
 * members). Draws from the same pool a fresh agent is seeded from, in the user's
 * language.
 *
 * Names already visible in the sidebar are excluded: the point of a name is to
 * tell two agents apart, so handing out a second "Alice" would defeat it. The
 * list is read at click time rather than subscribed to — it only matters at the
 * moment of the draw, and subscribing would re-render the header on every
 * sidebar change.
 */
export const useAutoName = (agentId: string) => {
  const { t } = useTranslation('setting');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const updateMetaById = useAgentStore((s) => s.updateAgentMetaById);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const [naming, setNaming] = useState(false);

  const autoName = useCallback(async () => {
    setNaming(true);
    try {
      const takenNames = homeAgentListSelectors
        .allAgents(useHomeStore.getState())
        .filter((agent) => agent.id !== agentId)
        .map((agent) => agent.name)
        .filter((name): name is string => !!name);

      await updateMetaById(agentId, { name: randomAgentName(locale, takenNames) });
      // The sidebar keeps its own copy of the label, so a rename that skips this
      // leaves the new name on the profile and the old one in the list until
      // something else revalidates. Refreshing here follows the same convention
      // as the sidebar's own rename popover.
      await refreshAgentList();
    } catch {
      toast.error(t('settingAgent.personalName.pickFailed'));
    } finally {
      setNaming(false);
    }
  }, [agentId, locale, refreshAgentList, t, updateMetaById]);

  return { autoName, naming };
};
