'use client';

import type { ItemType } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, stopPropagation } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './styles';

interface HierarchyNodeMenuButtonProps {
  /**
   * The same item list the row's right-click menu opens, so the two entry
   * points can never drift apart.
   */
  menuItems: () => ItemType[];
}

/**
 * Hover-revealed "..." on a tree row that opens the row's action menu. The
 * menu used to be reachable only through `onContextMenu`, which nobody finds.
 * Shares the `styles.nodeActions` reveal rules with the
 * folder "+" (see styles.ts): hidden until hover, and kept visible while open.
 */
const HierarchyNodeMenuButton = memo<HierarchyNodeMenuButtonProps>(({ menuItems }) => {
  const { t } = useTranslation('common');
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      {...stylex.props(styles.nodeActions)}
      data-open={menuOpen}
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
    >
      <DropdownMenu
        items={menuItems}
        open={menuOpen}
        placement="bottomLeft"
        onOpenChange={setMenuOpen}
      >
        <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={t('more')} />
      </DropdownMenu>
    </div>
  );
});

HierarchyNodeMenuButton.displayName = 'HierarchyNodeMenuButton';

export default HierarchyNodeMenuButton;
