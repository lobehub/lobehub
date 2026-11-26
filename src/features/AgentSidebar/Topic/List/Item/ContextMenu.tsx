import { ContextMenuTrigger } from '@lobehub/ui';
import { memo, type PropsWithChildren, type RefObject } from 'react';

import {
  type BuildMenuItems,
  useLazyMenuItems,
  usePublishMenuItems,
} from '@/features/NavPanel/components/useLazyMenuItems';

import { type TopicItemDropdownMenuProps, useTopicItemDropdownMenu } from './useDropdownMenu';

interface MenuHostProps extends TopicItemDropdownMenuProps {
  builderRef: RefObject<BuildMenuItems | undefined>;
}

const MenuHost = memo<MenuHostProps>(({ builderRef, fav, id, status, title }) => {
  const { dropdownMenu } = useTopicItemDropdownMenu({ fav, id, status, title });
  usePublishMenuItems(builderRef, dropdownMenu);
  return null;
});

MenuHost.displayName = 'TopicItemContextMenuHost';

/**
 * Right-click menu for a topic row. `useTopicItemDropdownMenu` reaches
 * `useNavigate` and the favorites sync, so mounting it on every row made each
 * topic switch re-render the whole list's menus; it now mounts only on rows the
 * user has reached (see `useLazyMenuItems`).
 */
const TopicItemContextMenu = memo<PropsWithChildren<TopicItemDropdownMenuProps>>(
  ({ children, fav, id, status, title }) => {
    const { arm, armed, builderRef, items } = useLazyMenuItems();

    return (
      <>
        {armed && (
          <MenuHost builderRef={builderRef} fav={fav} id={id} status={status} title={title} />
        )}
        <ContextMenuTrigger items={items} onFocus={arm} onPointerEnter={arm}>
          {children}
        </ContextMenuTrigger>
      </>
    );
  },
);

TopicItemContextMenu.displayName = 'TopicItemContextMenu';

export default TopicItemContextMenu;
