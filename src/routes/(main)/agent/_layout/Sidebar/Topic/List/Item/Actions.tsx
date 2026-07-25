import { ActionIcon } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';

import { useOverlayDropdownPortalProps } from '@/features/NavPanel/OverlayContainer';

interface ActionProps {
  dropdownMenu: DropdownItem[] | (() => DropdownItem[]);
}

const Actions = memo<ActionProps>(({ dropdownMenu }) => {
  const dropdownPortalProps = useOverlayDropdownPortalProps();

  return (
    <DropdownMenu
      items={dropdownMenu}
      portalProps={dropdownPortalProps}
      popupProps={{
        style: {
          maxHeight: 'var(--available-height)',
          overflowY: 'auto',
        },
      }}
    >
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
    </DropdownMenu>
  );
});

export default Actions;
