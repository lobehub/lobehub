import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';

const DOCUMENT_PREVIEW_LENGTH = 400;
const WEBPAGE_PREVIEW_LENGTH = 240;

interface CreateResourceContentPreviewOptions {
  content?: string | null;
  fileType: string;
  title: string;
}

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

  let text = content
    .replace(/^\s*---[\s\S]*?---\s*/, '')
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

  // Page markdown commonly starts with the same H1 already rendered as the
  // card title. Remove that duplicate before applying the response bound.
  if (fileType === CUSTOM_DOCUMENT_FILE_TYPE && text.startsWith(title)) {
    text = text.slice(title.length).trim();
  }

  if (!text) return null;

  const maxLength =
    fileType === 'article' || fileType.startsWith('text/html')
      ? WEBPAGE_PREVIEW_LENGTH
      : DOCUMENT_PREVIEW_LENGTH;

  return text.slice(0, maxLength);
};
