import type { SerializedEditorState } from 'lexical';

import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import { createDocumentHeadlessEditor } from '@/server/services/agentDocuments/headlessEditor';
import {
  composeSkillMarkdown,
  isSkillMarkdownDocument,
  parseSkillMarkdownFrontmatter,
} from '@/utils/skillMarkdown';

export type SerializedEditor = SerializedEditorState;

export interface StoredPage {
  content: string | null;
  editorData: unknown;
  filename?: string | null;
  fileType?: string | null;
  title?: string | null;
}

/** The stored page as editor state, recovered from Markdown for rows saved without one. */
export const editorDataFromRow = (row: StoredPage): SerializedEditor | null => {
  if (isValidEditorData(row.editorData)) return row.editorData as unknown as SerializedEditor;

  // A SKILL.md's frontmatter is metadata the editor never shows.
  const markdown = isSkillMarkdownDocument(row)
    ? parseSkillMarkdownFrontmatter(row.content).body
    : row.content;
  if (!markdown?.trim()) return null;

  const editor = createDocumentHeadlessEditor();
  try {
    editor.hydrateMarkdown(markdown, { keepId: true });
    return editor.export().editorData;
  } finally {
    editor.destroy();
  }
};

/**
 * The `content` to store for an edited body. The editor holds only the body,
 * so a SKILL.md keeps the frontmatter already stored, as the client's own
 * save does.
 */
export const toStoredMarkdown = (row: StoredPage, markdown: string) =>
  isSkillMarkdownDocument(row)
    ? composeSkillMarkdown(parseSkillMarkdownFrontmatter(row.content).frontmatter, markdown)
    : markdown;
