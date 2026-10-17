import type { DropdownItem } from '@lobehub/ui';
import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

import { useOverlayDropdownPortalProps } from '@/features/NavPanel/OverlayContainer';

interface ActionProps {
  dropdownMenu: DropdownItem[] | (() => DropdownItem[]);
}

const Actions = memo<ActionProps>(({ dropdownMenu }) => {
  const dropdownPortalProps = useOverlayDropdownPortalProps();

  return (
    <DropdownMenu items={dropdownMenu} portalProps={dropdownPortalProps}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
    </DropdownMenu>
  );
});

export default Actions;
