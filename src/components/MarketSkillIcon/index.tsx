import { Avatar } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';

export const SKILL_ICON_SIZE = 20;

interface MarketSkillIconProps {
  /** Optional placeholder while loading or when no publisher icon is available. */
  fallback?: ReactNode;
  identifier: string;
  name?: string;
  size?: number;
}

/**
 * Market agent skill icon component.
 *
 * Looks up the skill in the LobeHub Market via SWR (cached/dedup'd) so the
 * panel displays the same publisher icon shown in the Skill Store. Falls back
 * to an Avatar generated from the skill name while loading, or when the skill
 * is not present in the market (e.g. user-imported skills from a custom URL).
 */
const MarketSkillIcon = memo<MarketSkillIconProps>(
  ({ fallback, identifier, name, size = SKILL_ICON_SIZE }) => {
    const useFetchSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
    const { queryKey } = useFetchSkillDetail({ identifier });
    const data = useDiscoverStore(skillSelectors.skillDetail(queryKey));

    if (!data?.icon && fallback !== undefined) return fallback;

    return (
      <Avatar
        avatar={data?.icon || name || identifier}
        shape={'square'}
        size={size}
        style={{ flex: 'none', marginInlineEnd: 0 }}
        title={name}
      />
    );
  },
);

MarketSkillIcon.displayName = 'MarketSkillIcon';

export default MarketSkillIcon;
