import { Avatar } from '@lobehub/ui';
import { memo } from 'react';

import { useDiscoverStore } from '@/store/discover';

import ToolItemDetailPopover from './ToolItemDetailPopover';

interface MarketAgentSkillPopoverContentProps {
  description?: string | null;
  identifier: string;
  name: string;
  sourceLabel: string;
}

/**
 * Popover content for market-installed agent skills.
 *
 * Looks up the market metadata via SWR (cached) so the popover can show the
 * publisher icon and the marketplace description / version when available,
 * falling back to the locally stored description.
 */
const MarketAgentSkillPopoverContent = memo<MarketAgentSkillPopoverContentProps>(
  ({ identifier, name, description, sourceLabel }) => {
    const useFetchSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
    const { data } = useFetchSkillDetail({ identifier });

    const iconSource = data?.icon || name;

    return (
      <ToolItemDetailPopover
        description={data?.description || description || undefined}
        identifier={identifier}
        sourceLabel={sourceLabel}
        title={data?.name || name}
        icon={
          <Avatar
            avatar={iconSource}
            shape={'square'}
            size={36}
            style={{ flex: 'none', marginInlineEnd: 0 }}
          />
        }
      />
    );
  },
);

MarketAgentSkillPopoverContent.displayName = 'MarketAgentSkillPopoverContent';

export default MarketAgentSkillPopoverContent;
