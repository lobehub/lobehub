import type { DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { LucideCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useTopicOnlyMine } from '@/hooks/useTopicOnlyMine';
import { useUserStore } from '@/store/user';

/**
 * "Only my topics" toggle for the topic filter menus. A workspace lists every
 * member's topics under a shared agent, so the toggle exists only there and is
 * stored per member per workspace. Returns `null` in personal mode.
 */
export const useOnlyMineFilterItem = (): DropdownItem | null => {
  const { t } = useTranslation('topic');
  const hasActiveWorkspace = useHasActiveWorkspace();
  const onlyMine = useTopicOnlyMine();
  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);

  return useMemo(() => {
    if (!hasActiveWorkspace) return null;

    return {
      icon: onlyMine ? <Icon icon={LucideCheck} /> : <div />,
      key: 'onlyMine',
      label: t('filter.onlyMine'),
      onClick: () => {
        void updateWorkspaceUserPreference({ topicOnlyMine: !onlyMine });
      },
    };
  }, [hasActiveWorkspace, onlyMine, updateWorkspaceUserPreference, t]);
};
