import type { ChatFileItem } from '@lobechat/types';

/**
 * Attachments whose extracted text exceeds this many characters are previewed instead of inlined.
 *
 * Parsed spreadsheets, CSV exports, and logs can reach 100+ MiB of text. Inlining them overflows
 * every model's context window, and because history re-injects attachments on each turn, the
 * whole topic keeps failing afterwards. Context compression cannot help: the latest user message
 * is always kept intact.
 */
export const FILE_INLINE_MAX_CHARS = 100_000;

/** Leading characters kept as a preview when an attachment exceeds `FILE_INLINE_MAX_CHARS`. */
export const FILE_PREVIEW_CHARS = 4000;

const fileBody = (content: string) => {
  if (content.length <= FILE_INLINE_MAX_CHARS) return { attributes: '', body: content };

  return {
    attributes: ` truncated="true" total_chars="${content.length}"`,
    body: `${content.slice(0, FILE_PREVIEW_CHARS)}
[Only the first ${FILE_PREVIEW_CHARS} of ${content.length} characters are shown. Do not treat this preview as the complete file. To work with the rest, use an available file tool (for example, read this file id in windows, or process the file in a code sandbox or at its local path) instead of asking the user to paste it.]`,
  };
};

const filePrompt = (item: ChatFileItem, addUrl: boolean) => {
  const { attributes, body } = fileBody(item.content || '');
  return addUrl
    ? `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}" url="${item.url}"${attributes}>${body}</file>`
    : `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}"${attributes}>${body}</file>`;
};

export const filePrompts = (fileList: ChatFileItem[], addUrl: boolean) => {
  if (fileList.length === 0) return '';

  const prompt = `<files>
<files_docstring>here are user upload files you can refer to</files_docstring>
${fileList.map((item) => filePrompt(item, addUrl)).join('\n')}
</files>`;

  return prompt.trim();
};
