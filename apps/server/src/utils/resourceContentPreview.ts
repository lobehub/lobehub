import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import matter from 'gray-matter';

const DOCUMENT_PREVIEW_LENGTH = 400;
const WEBPAGE_PREVIEW_LENGTH = 240;

interface CreateResourceContentPreviewOptions {
  content?: string | null;
  fileType: string;
  title: string;
}

const stripMetadataFrontmatter = (content: string) => {
  try {
    const parsed = matter(content);
    const data = parsed.data;
    return data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0
      ? parsed.content
      : content;
  } catch {
    return content;
  }
};

const stripDuplicatedTitleHeading = (content: string, fileType: string, title: string) => {
  if (fileType !== CUSTOM_DOCUMENT_FILE_TYPE) return content;

  const newlineIndex = content.indexOf('\n');
  const firstLine = (newlineIndex === -1 ? content : content.slice(0, newlineIndex)).trim();
  if (!firstLine.startsWith('# ')) return content;

  const headingTitle = firstLine
    .slice(2)
    .replace(/\s+#+$/, '')
    .trim();
  if (headingTitle !== title.trim()) return content;

  return newlineIndex === -1 ? '' : content.slice(newlineIndex + 1);
};

/**
 * Turn the bounded content prefix selected by `KnowledgeRepo` into the final
 * plain-text list preview. This belongs on the server so clients never receive
 * a document body just to discard almost all of it.
 */
export const createResourceContentPreview = ({
  content,
  fileType,
  title,
}: CreateResourceContentPreviewOptions): string | null => {
  if (!content) return null;

  let text = stripDuplicatedTitleHeading(stripMetadataFrontmatter(content), fileType, title)
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Strip tags to a fixpoint: a single pass can splice a new tag together
  // (`<scr<b>ipt>` -> `<script>`).
  let previous: string;
  do {
    previous = text;
    text = text.replaceAll(/<\/?[a-z][^>]*>/gi, '');
  } while (text !== previous);

  text = text
    .replaceAll(/:?-{3,}:?/g, ' ')
    .replaceAll(/\[\s*\]/g, '')
    .replaceAll(/[#*<>`_\\|]/g, '')
    .replaceAll(/\(\s*\)/g, '')
    .replaceAll(/[()[\]]{2,}/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

  if (!text) return null;

  const maxLength =
    fileType === 'article' || fileType.startsWith('text/html')
      ? WEBPAGE_PREVIEW_LENGTH
      : DOCUMENT_PREVIEW_LENGTH;

  return text.slice(0, maxLength);
};
