'use client';

import { ActionIcon, type DropdownItem, DropdownMenu } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { folderCardMarker } from './markers.stylex';

const styles = stylex.create({
  actions: {
    // Over the pocket's top-right corner, beside the project name.
    insetBlockStart: 207,
    insetInlineEnd: 12,
    opacity: {
      'default': 0,
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover', folderCardMarker)]: 1,
      [stylex.when.ancestor(':focus-within', folderCardMarker)]: 1,
    },
    position: 'absolute',
    transitionDuration: cssVar.motionDurationFast,
    transitionProperty: 'opacity',
    zIndex: 2,
  },
});

interface FolderCardActionsProps {
  deleting?: boolean;
  menuItems: DropdownItem[];
}

// `data-row-action` keeps a press on the ⋯ button from picking the card up
// for a manual-sort drag (see RowMouseSensor / RowTouchSensor).
export const FolderCardActions = memo<FolderCardActionsProps>(({ deleting, menuItems }) => {
  const { t } = useTranslation('project');

  return (
    <span data-row-action {...stylex.props(styles.actions)}>
      <DropdownMenu items={menuItems} placement={'bottomRight'}>
        <ActionIcon
          icon={MoreHorizontalIcon}
          loading={deleting}
          size={'small'}
          title={t('list.moreActions')}
        />
      </DropdownMenu>
    </span>
  );
});

FolderCardActions.displayName = 'FolderCardActions';
