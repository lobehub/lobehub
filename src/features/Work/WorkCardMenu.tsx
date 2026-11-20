'use client';

import { ActionIcon, DropdownMenu, stopPropagation } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  useWorkCardMenuItems,
  type WorkCardMenuTarget,
} from '@/business/client/hooks/useWorkCardMenuItems';

interface WorkCardMenuProps {
  item: WorkCardMenuTarget;
}

/**
 * The "more" button of a conversation Work card. Renders nothing until some
 * action applies to the Work, so a card without actions keeps its plain look.
 */
const WorkCardMenu = ({ item }: WorkCardMenuProps) => {
  const { t } = useTranslation('common');
  const items = useWorkCardMenuItems(item);
  if (!items || items.length === 0) return null;

  return (
    // The menu renders in a portal, but React still bubbles its clicks through
    // this element; stopping them here keeps a menu pick from opening the card.
    <span onClick={stopPropagation}>
      <DropdownMenu items={items} placement={'bottomRight'}>
        <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={t('more')} />
      </DropdownMenu>
    </span>
  );
};

export default WorkCardMenu;
