import { ContextMenuTrigger } from '@lobehub/ui/base-ui';
import { memo, type PropsWithChildren, useCallback, useEffect, useRef } from 'react';

import { type TopicItemDropdownMenuProps, useTopicItemDropdownMenu } from './useDropdownMenu';

/**
 * Hosts the row's menu hook outside the row's memo boundary.
 *
 * `useTopicItemDropdownMenu` reaches `useNavigate`, which subscribes to
 * react-router's contexts — so wherever it is called re-renders on every
 * navigation. Calling it here keeps that re-render to this shell: `children`
 * arrives as an already-built element, so React bails out on the row subtree.
 *
 * The items thunk is pinned to a stable identity for the same reason — a fresh
 * one would flow into `cloneElement` below and break the row's memo anyway.
 */
const TopicItemContextMenu = memo<PropsWithChildren<TopicItemDropdownMenuProps>>(
  ({ children, fav, id, status, title }) => {
    const { dropdownMenu } = useTopicItemDropdownMenu({ fav, id, status, title });

    const menuRef = useRef(dropdownMenu);
    useEffect(() => {
      menuRef.current = dropdownMenu;
    }, [dropdownMenu]);

    const items = useCallback(() => menuRef.current(), []);

    return <ContextMenuTrigger items={items}>{children}</ContextMenuTrigger>;
  },
);

TopicItemContextMenu.displayName = 'TopicItemContextMenu';

export default TopicItemContextMenu;
