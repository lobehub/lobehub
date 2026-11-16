// Pure module: the parse worker bundles it, so it must not import the document service, the
// database, or anything that reads the environment.
import type { FileDocument } from '@lobechat/file-loaders';
import { sliceHead } from '@lobechat/prompts/textWindow';

/**
 * Upper bound, in characters, of parsed file text stored in `documents.content`.
 *
 * Parsing raw CSV exports, logs, or sparse spreadsheets can yield 100+ MiB of text. Rows that large
 * slow every read of the document, overflow the model context when attached, and cannot be synced
 * to full-text search. The original file stays in storage for tools that process it directly.
 */
export const PARSED_FILE_CONTENT_MAX_CHARS = 5_000_000;

export type ParsedFileDocument = FileDocument;

const PAGE_CLOSE_TAG = '\n</page>';

/**
 * PDF loaders wrap each page in `<page ...>...</page>`. A cut inside a page leaves an opening tag
 * with no closing tag (or a half-written tag at the tail), which previews and `readAttachment`
 * would expose as malformed markup. Close the cut page, or drop a half-written opening tag, while
 * staying within the cap. Page tags are kept rather than stripped so page numbers survive.
 */
const closeCutPage = (content: string): string => {
  const open = content.lastIndexOf('<page');
  if (open === -1 || open < content.lastIndexOf('</page>')) return content;

  const openEnd = content.indexOf('>', open);
  if (openEnd === -1) return content.slice(0, open).trimEnd();

  const bodyEnd = Math.max(openEnd + 1, content.length - PAGE_CLOSE_TAG.length);
  const body = content.slice(0, bodyEnd).replace(/<\/?(?:p(?:a(?:ge?)?)?)?$/, '');
  return `${body}${PAGE_CLOSE_TAG}`;
};

/**
 * Truncates oversized parsed text before it is stored. `pages` repeats the full text, so it is
 * dropped for truncated documents; `metadata` records the original length.
 */
export const capParsedFileDocument = (fileDocument: ParsedFileDocument): ParsedFileDocument => {
  if (fileDocument.content.length <= PARSED_FILE_CONTENT_MAX_CHARS) return fileDocument;

  const head = sliceHead(fileDocument.content, PARSED_FILE_CONTENT_MAX_CHARS);
  // Only the PDF loader emits page wrappers; other text may contain a literal `<page` to keep.
  const content = fileDocument.fileType === 'pdf' ? closeCutPage(head) : head;
  return {
    ...fileDocument,
    content,
    metadata: {
      ...fileDocument.metadata,
      originalCharCount: fileDocument.content.length,
      truncated: true,
    },
    pages: undefined,
    totalCharCount: content.length,
    totalLineCount: content.split('\n').length,
  };
};

/**
 * Page editor text carries no `<page>` wrappers. Strip them before capping: a cut inside a page
 * would leave an opening tag with no closing tag, which the strip regex can no longer match.
 */
export const stripPageWrappers = (fileDocument: ParsedFileDocument): ParsedFileDocument =>
  fileDocument.content.includes('<page')
    ? {
        ...fileDocument,
        content: fileDocument.content.replaceAll(/<page[^>]*>([\S\s]*?)<\/page>/g, '$1').trim(),
      }
    : fileDocument;
