'use client';

import { ActionIcon, Block, DropdownMenu, Flexbox, Icon, stopPropagation, Text } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { MoreHorizontalIcon, NotebookPenIcon, Trash } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatNoteTime } from '@/features/QuickNote/utils';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { QuickNoteItem } from '@/services/quickNote';
import { useQuickNoteStore } from '@/store/quickNote';

const FeedItem = memo<{ note: QuickNoteItem }>(({ note }) => {
  const { t } = useTranslation(['note', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const removeNote = useQuickNoteStore((s) => s.removeNote);

  const menuItems = [
    {
      icon: <Icon icon={NotebookPenIcon} />,
      key: 'open',
      label: t('feed.open'),
      onClick: () => navigate(`/note/${note.id}`),
    },
    { type: 'divider' as const },
    {
      danger: true,
      icon: <Icon icon={Trash} />,
      key: 'delete',
      label: t('delete', { ns: 'common' }),
      onClick: () =>
        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('feed.deleteConfirm'),
          okButtonProps: { danger: true },
          okText: t('delete', { ns: 'common' }),
          onOk: () => removeNote(note.id),
        }),
    },
  ];

  return (
    <Block
      clickable
      gap={10}
      paddingBlock={16}
      paddingInline={20}
      variant={'outlined'}
      onClick={() => navigate(`/note/${note.id}`)}
    >
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text fontSize={12} type={'secondary'}>
          {formatNoteTime(note.createdAt)}
        </Text>
        <div onClick={stopPropagation}>
          <DropdownMenu items={menuItems} nativeButton={false}>
            <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
          </DropdownMenu>
        </div>
      </Flexbox>
      <Text ellipsis={{ rows: 4 }} style={{ whiteSpace: 'pre-line' }}>
        {note.content}
      </Text>
      {note.tags.length > 0 && (
        <Text fontSize={12} type={'secondary'}>
          {[note.tags.join(' · '), note.location].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Block>
  );
});

FeedItem.displayName = 'HomeNotesFeedItem';

export default FeedItem;
