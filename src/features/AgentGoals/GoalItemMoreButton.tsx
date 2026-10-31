'use client';

import { ActionIcon, type DropdownItem, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

// The menu renders in a portal, whose React events still bubble to the row it sits in.
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

/** The "more" button of a clickable goal row: opening it or picking an item must not open the goal. */
const GoalItemMoreButton = memo<{ items: DropdownItem[] }>(({ items }) => {
  const { t } = useTranslation('chat');

  return (
    <div onClick={stopPropagation} onKeyDown={stopPropagation}>
      <DropdownMenu items={items} placement={'bottomRight'}>
        <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={t('goalDetail.moreActions')} />
      </DropdownMenu>
    </div>
  );
});

GoalItemMoreButton.displayName = 'GoalItemMoreButton';

export default GoalItemMoreButton;
