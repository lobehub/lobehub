import type { DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { LucideCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import {
  useSetTopicOnlyMine,
  useTopicOnlyMine,
  useTopicOnlyMineOwnerId,
} from '@/hooks/useTopicOnlyMine';

/**
 * "Only my topics" toggle for the topic filter menus. A workspace lists every
 * member's topics under a shared agent, so the toggle exists only there and is
 * stored on this device per agent (group / project). Returns `null` in
 * personal mode.
 */
export const useOnlyMineFilterItem = (): DropdownItem | null => {
  const { t } = useTranslation('topic');
  const hasActiveWorkspace = useHasActiveWorkspace();
  const ownerId = useTopicOnlyMineOwnerId();
  const onlyMine = useTopicOnlyMine();
  const setOnlyMine = useSetTopicOnlyMine();

  return useMemo(() => {
    if (!hasActiveWorkspace || !ownerId) return null;

    return {
      icon: onlyMine ? <Icon icon={LucideCheck} /> : <div />,
      key: 'onlyMine',
      label: t('filter.onlyMine'),
      onClick: () => setOnlyMine(ownerId, !onlyMine),
    };
  }, [hasActiveWorkspace, ownerId, onlyMine, setOnlyMine, t]);
};
