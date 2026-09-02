'use client';

import { Flexbox, SearchBar, Text } from '@lobehub/ui';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuickNoteStore } from '@/store/quickNote';

import FeedItem from './FeedItem';

const NotesFeed = memo(() => {
  const { t } = useTranslation('note');
  const initNotes = useQuickNoteStore((s) => s.initNotes);
  const notes = useQuickNoteStore((s) => s.notes);
  const notesInit = useQuickNoteStore((s) => s.notesInit);
  const [keywords, setKeywords] = useState('');

  useEffect(() => {
    initNotes();
  }, [initNotes]);

  const list = useMemo(() => {
    const kw = keywords.trim().toLowerCase();
    return [...notes]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((note) => !kw || note.content.toLowerCase().includes(kw));
  }, [notes, keywords]);

  if (!notesInit) return null;

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Text weight={600}>{t('sidebar.allNotes')}</Text>
          <Text fontSize={12} type={'secondary'}>
            {t('list.count', { count: list.length })}
          </Text>
        </Flexbox>
        <SearchBar
          allowClear
          placeholder={t('list.searchPlaceholder')}
          style={{ maxWidth: 260 }}
          onSearch={setKeywords}
        />
      </Flexbox>
      {list.length === 0 ? (
        <Text align={'center'} fontSize={12} style={{ paddingBlock: 32 }} type={'secondary'}>
          {keywords.trim() ? t('list.empty') : t('feed.empty')}
        </Text>
      ) : (
        <Flexbox gap={12}>
          {list.map((note) => (
            <FeedItem key={note.id} note={note} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

NotesFeed.displayName = 'HomeNotesFeed';

export default NotesFeed;
