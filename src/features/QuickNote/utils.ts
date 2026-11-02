import dayjs from 'dayjs';

import type { QuickNoteItem } from '@/services/quickNote';

export const formatNoteTime = (timestamp: number) => dayjs(timestamp).format('MM/DD HH:mm');

export const formatNoteDate = (timestamp: number) => dayjs(timestamp).format('MM/DD');

export const formatNoteMeta = (
  note: Pick<QuickNoteItem, 'collection' | 'createdAt' | 'location'>,
) => [formatNoteTime(note.createdAt), note.collection, note.location].filter(Boolean).join(' · ');

const MARKDOWN_LINE_PREFIX = /^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/;

export const getNoteTitle = (content: string) =>
  content
    .split('\n')
    .map((line) => line.trim().replace(MARKDOWN_LINE_PREFIX, ''))
    .find(Boolean) ?? '';
