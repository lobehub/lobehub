'use client';

import { DropdownMenu, stopPropagation } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import type { ItemType } from 'antd/es/menu/interface';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
 * Shares the `.hierarchy-node-actions` reveal rules with the
 * folder "+" (see styles.ts): hidden until hover, and kept visible while open.
 */
const HierarchyNodeMenuButton = memo<HierarchyNodeMenuButtonProps>(({ menuItems }) => {
  const { t } = useTranslation('common');
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={'hierarchy-node-actions'}
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
