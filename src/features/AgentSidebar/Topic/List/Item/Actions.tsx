import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { Archive, ArchiveRestore, MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useOverlayDropdownPortalProps } from '@/features/NavPanel/OverlayContainer';

import { type TopicItemDropdownMenuProps, useTopicItemDropdownMenu } from './useDropdownMenu';

interface ActionsProps extends TopicItemDropdownMenuProps {
  /** Only the sidebar row opts in to the inline archive icon — headers keep the menu. */
  showInlineArchive?: boolean;
}

const Actions = memo<ActionsProps>(
  ({ completionLabel, fav, id, showInlineArchive, status, title }) => {
    const { t } = useTranslation('topic');
    const { canInlineArchive, dropdownMenu, isCompleted, toggleCompleted } =
      useTopicItemDropdownMenu({ completionLabel, fav, id, status, title });
    const dropdownPortalProps = useOverlayDropdownPortalProps();

    return (
      <>
        {showInlineArchive && canInlineArchive && (
          <ActionIcon
            icon={isCompleted ? ArchiveRestore : Archive}
            size={'small'}
            title={isCompleted ? t('actions.unmarkCompleted') : t('actions.markCompleted')}
            onClick={() => void toggleCompleted()}
          />
        )}
        <DropdownMenu items={dropdownMenu} portalProps={dropdownPortalProps}>
          <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
        </DropdownMenu>
      </>
    );
  },
);

export default Actions;
