'use client';

import { Block } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import { formatNoteTime, getNoteTitle } from '../utils';

const Item = memo<{ noteId: string }>(({ noteId }) => {
  const { t } = useTranslation('note');
  const navigate = useWorkspaceAwareNavigate();
  const active = useQuickNoteStore((s) => s.activeNoteId === noteId);

  const preview = useQuickNoteStore((s) => {
    const note = quickNoteSelectors.noteById(noteId)(s);
    if (!note) return undefined;
    return {
      createdAt: note.createdAt,
      footer: [note.tags[0], note.location].filter(Boolean).join(' · '),
      title: getNoteTitle(note.content),
    };
  });

  if (!preview) return null;
  const { createdAt, footer } = preview;
  const title = preview.title || t('list.untitled');

  return (
    <Block
      clickable
      gap={6}
      paddingBlock={12}
      paddingInline={12}
      variant={active ? 'filled' : 'borderless'}
      onClick={() => navigate(`/note/${noteId}`)}
    >
      <Text color={cssVar.colorTextTertiary} fontSize={12}>
        {formatNoteTime(createdAt)}
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
