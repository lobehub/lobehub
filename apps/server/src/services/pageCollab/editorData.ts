import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';

import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import { createDocumentHeadlessEditor } from '@/server/services/agentDocuments/headlessEditor';
import {
  composeSkillMarkdown,
  isSkillMarkdownDocument,
  parseSkillMarkdownFrontmatter,
} from '@/utils/skillMarkdown';

export type SerializedEditor = SerializedEditorState<SerializedLexicalNode>;

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

const BLANK_BLOCK_TYPES = new Set(['linebreak', 'paragraph', 'root', 'text']);

// Any non-blank text, or any block other than an empty paragraph (image, divider, table…).
const holdsContent = (node: unknown): boolean => {
  if (!node || typeof node !== 'object') return false;
  const { children, text, type } = node as { children?: unknown; text?: unknown; type?: unknown };
  if (typeof text === 'string' && text.trim()) return true;
  if (typeof type === 'string' && !BLANK_BLOCK_TYPES.has(type)) return true;
  return Array.isArray(children) && children.some(holdsContent);
};

/** Whether the stored page has a body at all, read from its Markdown or its editor state. */
export const hasStoredBody = (row: StoredPage): boolean => {
  const markdown = isSkillMarkdownDocument(row)
    ? parseSkillMarkdownFrontmatter(row.content).body
    : row.content;
  if (markdown?.trim()) return true;
  return (
    isValidEditorData(row.editorData) &&
    holdsContent((row.editorData as unknown as SerializedEditor).root)
  );
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
