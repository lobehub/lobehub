'use client';

import { Flexbox, Markdown, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import { formatNoteTime } from '../utils';
import { styles } from './style';

const MetaRow = memo<{ label: string; value: string }>(({ label, value }) => (
  <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
    <Text color={cssVar.colorTextTertiary} fontSize={12}>
      {label}
    </Text>
    <Text fontSize={12}>{value}</Text>
  </Flexbox>
));

MetaRow.displayName = 'QuickNoteMetaRow';

const AnnotationPanel = memo<{ noteId: string }>(({ noteId }) => {
  const { t } = useTranslation('note');

  const note = useQuickNoteStore(quickNoteSelectors.noteById(noteId));
  const diving = useQuickNoteStore(quickNoteSelectors.isDiving(noteId));
  const diveInto = useQuickNoteStore((s) => s.diveInto);
  const bodyRef = useRef<HTMLDivElement>(null);

  const annotationContent = note?.annotation?.content;

  useEffect(() => {
    if (!diving || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [diving, annotationContent]);

  if (!note) return null;

  const { annotation } = note;
  const dived = Boolean(annotation?.divedAt);

  return (
    <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.sectionHeader}
        justify={'space-between'}
        paddingBlock={12}
        paddingInline={16}
      >
        <Text weight={500}>{t('annotation.title')}</Text>
        <Button
          disabled={!note.content.trim()}
          loading={diving}
          size={'small'}
          onClick={() => diveInto(noteId)}
        >
          {dived ? t('annotation.redive') : t('annotation.dive')}
        </Button>
      </Flexbox>
      <Flexbox
        flex={1}
        gap={16}
        paddingBlock={16}
        paddingInline={16}
        ref={bodyRef}
        style={{ overflowY: 'auto' }}
      >
        <Flexbox gap={6}>
          <MetaRow label={t('annotation.createdAt')} value={formatNoteTime(note.createdAt)} />
          <MetaRow label={t('annotation.updatedAt')} value={formatNoteTime(note.updatedAt)} />
          <MetaRow
            label={t('annotation.divedAt')}
            value={
              diving
                ? t('annotation.diving')
                : annotation?.divedAt
                  ? formatNoteTime(annotation.divedAt)
                  : t('annotation.notDived')
            }
          />
        </Flexbox>
        {annotation?.content ? (
          <Markdown fontSize={14} variant={'chat'}>
            {annotation.content}
          </Markdown>
        ) : (
          <Text color={cssVar.colorTextTertiary} fontSize={12}>
            {note.content.trim() ? t('annotation.waiting') : t('annotation.emptyNote')}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  );
});

AnnotationPanel.displayName = 'QuickNoteAnnotationPanel';

export default AnnotationPanel;
