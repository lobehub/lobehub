import { Avatar } from '@lobehub/ui';
import { memo } from 'react';

import { useDiscoverStore } from '@/store/discover';

export const SKILL_ICON_SIZE = 20;

interface MarketSkillIconProps {
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
  ({ identifier, name, size = SKILL_ICON_SIZE }) => {
    const useFetchSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
    const { data } = useFetchSkillDetail({ identifier });

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
