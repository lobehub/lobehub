import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

import { useOverlayDropdownPortalProps } from '@/features/NavPanel/OverlayContainer';

import { type TopicItemDropdownMenuProps, useTopicItemDropdownMenu } from './useDropdownMenu';

const Actions = memo<TopicItemDropdownMenuProps>(({ fav, id, status, title }) => {
  const { dropdownMenu } = useTopicItemDropdownMenu({ fav, id, status, title });
  const dropdownPortalProps = useOverlayDropdownPortalProps();

  return (
    <DropdownMenu items={dropdownMenu} portalProps={dropdownPortalProps}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
    </DropdownMenu>
  );
});

export default Actions;
