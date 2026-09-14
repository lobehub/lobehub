import dayjs from 'dayjs';

export const formatNoteTime = (timestamp: number) => dayjs(timestamp).format('MM/DD HH:mm');

export const getNoteTitle = (content: string) =>
  content
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? '';

// Feeding '' through the markdown data source yields an empty root node, which
// Lexical rejects in setEditorState; the text type seeds an empty paragraph.
export const resolveNoteEditorContent = (content: string) => ({
  content,
  type: content ? ('markdown' as const) : ('text' as const),
});
