import type { DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { LucideCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { useTopicListScope } from './TopicListScope';

/**
 * "Show topics others opened for me": sub-topics another conversation
 * opened for this agent live under their opener and stay out of this agent's
 * own list unless this is on. Only an agent's own list (not a group or a
 * project) under Better Coding Experience; stored on this device per agent.
 */
export const useShowOpenedForMeFilterItem = (): DropdownItem | null => {
  const { t } = useTranslation('topic');
  const labEnabled = useUserStore(labPreferSelectors.enableBetterCodingExperience);
  const scope = useTopicListScope();
  const [agentId, groupId] = useChatStore((s) => [s.activeAgentId, s.activeGroupId]);
  const enabled = useGlobalStore(systemStatusSelectors.topicShowOpenedForMe(agentId));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  return useMemo(() => {
    if (!labEnabled || scope || groupId || !agentId) return null;

    return {
      icon: enabled ? <Icon icon={LucideCheck} /> : <div />,
      key: 'showOpenedForMe',
      label: t('filter.showOpenedForMe'),
      onClick: () => updateSystemStatus({ topicShowOpenedForMeByAgent: { [agentId]: !enabled } }),
    };
  }, [agentId, enabled, groupId, labEnabled, scope, t, updateSystemStatus]);
};
