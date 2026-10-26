import { CUSTOM_FOLDER_FILE_TYPE, HTML_DOCUMENT_FILE_TYPE } from '@lobechat/const';

import { extractMarkdownH1Title } from '@/database/models/agentDocuments';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';

import { createMarkdownEditorSnapshot } from '../agentDocuments/headlessEditor';

interface ResolveDocumentWriteParams {
  content?: string;
  editorData?: Record<string, any>;
  fileType?: string;
  /** The document title after this write; names the heading that repeats it. */
  title?: string;
}

interface ResolvedDocumentWrite {
  content?: string;
  editorData?: Record<string, any>;
}

const normalizeHeadingText = (value: string) =>
  value
    .replace(/\s+#+\s*$/, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Whether a leading heading only restates the title: the same text, or one is
 * the other plus a suffix that starts at a word boundary, e.g. the title
 * `Weekly Report (2026-10-20)` and the heading `Weekly Report`.
 */
const isTitleHeading = (heading: string, title: string) => {
  const normalizedHeading = normalizeHeadingText(heading);
  const normalizedTitle = normalizeHeadingText(title);
  if (!normalizedHeading || !normalizedTitle) return false;
  if (normalizedHeading === normalizedTitle) return true;

  const [shorter, longer] =
    normalizedHeading.length < normalizedTitle.length
      ? [normalizedHeading, normalizedTitle]
      : [normalizedTitle, normalizedHeading];
  return longer.startsWith(shorter) && !/^[\p{L}\p{N}]/u.test(longer.slice(shorter.length));
};

/**
 * Drop a leading `# Heading` that repeats the document title. The title already
 * renders as the page header, so that heading reads as a second page title.
 *
 * Unlike agent documents, which always drop the first H1, a heading that names
 * something else is kept: these writes also carry user-authored Markdown (verify
 * instructions, pages saved from a message) whose opening heading is content.
 */
export const stripTitleHeading = (content: string, title?: string): string => {
  if (!title) return content;

  const { content: body, title: heading } = extractMarkdownH1Title(content);
  return heading && isTitleHeading(heading, title) ? body : content;
};

/**
 * Resolve the content and editorData to persist for a document write.
 *
 * Clients that cannot build Lexical state (the CLI, agent tools) send only
 * Markdown content, and older CLI builds sent `{ type: 'doc', content }`.
 * Persisting either leaves every reader to re-parse Markdown, which mints new
 * node ids on each read, so the ids an agent reads are gone by the time it
 * edits nodes by id. Build real Lexical state from the content instead; valid
 * editorData is kept as-is, and so is the content it was saved with.
 *
 * Content that is turned into editorData here comes from Markdown, so its
 * leading title heading is dropped first (see {@link stripTitleHeading}).
 *
 * An HTML document's content is not Markdown and is never edited as rich text,
 * so it carries no editorData at all.
 */
export const resolveDocumentWrite = async ({
  content,
  editorData,
  fileType,
  title,
}: ResolveDocumentWriteParams): Promise<ResolvedDocumentWrite> => {
  if (fileType === HTML_DOCUMENT_FILE_TYPE) return { content, editorData: undefined };
  if (isValidEditorData(editorData)) return { content, editorData };
  if (content === undefined || fileType === CUSTOM_FOLDER_FILE_TYPE) return { content, editorData };

  const body = stripTitleHeading(content, title);
  const snapshot = await createMarkdownEditorSnapshot(body);
  return { content: body, editorData: snapshot.editorData };
};
