'use client';

import { Block, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { QuickNoteItem } from '@/services/quickNote';
import { useQuickNoteStore } from '@/store/quickNote';

import { formatNoteTime, getNoteTitle } from '../utils';

const Item = memo<{ note: QuickNoteItem }>(({ note }) => {
  const { t } = useTranslation('note');
  const navigate = useWorkspaceAwareNavigate();
  const active = useQuickNoteStore((s) => s.activeNoteId === note.id);

  const title = getNoteTitle(note.content) || t('list.untitled');
  const footer = [note.tags[0], note.location].filter(Boolean).join(' · ');

  return (
    <Block
      clickable
      gap={6}
      paddingBlock={12}
      paddingInline={12}
      variant={active ? 'filled' : 'borderless'}
      onClick={() => navigate(`/note/${note.id}`)}
    >
      <Text color={cssVar.colorTextTertiary} fontSize={12}>
        {formatNoteTime(note.createdAt)}
      </Text>
      <Text ellipsis={{ rows: 2 }}>{title}</Text>
      {footer && (
        <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
          {footer}
        </Text>
      )}
    </Block>
  );
});

Item.displayName = 'QuickNoteListItem';

export default Item;
