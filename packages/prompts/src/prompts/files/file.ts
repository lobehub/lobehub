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

const countLines = (content: string) => {
  let lines = 1;
  for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) {
    lines += 1;
  }
  return lines;
};

/**
 * Inline a file's text, or replace it with a preview when it exceeds `FILE_INLINE_MAX_CHARS`.
 * The returned attributes tell the model the full size so it can page through the rest with
 * `readKnowledge`, which the runtime enables whenever such a preview is sent.
 */
export const previewLongFileContent = (content: string) => {
  if (content.length <= FILE_INLINE_MAX_CHARS) return { attributes: '', body: content };

  const totalLines = countLines(content);
  return {
    attributes: ` truncated="true" total_chars="${content.length}" total_lines="${totalLines}"`,
    body: `${content.slice(0, FILE_PREVIEW_CHARS)}
[Only the first ${FILE_PREVIEW_CHARS} of ${content.length} characters (${totalLines} lines) are shown. Do not treat this preview as the complete file. Read the rest with the readKnowledge tool, passing this file id and an offset to page through it; if the task needs the whole file (for example aggregating a large table), process it in a code sandbox or at its local path when available. Do not ask the user to paste it.]`,
  };
};

const filePrompt = (item: ChatFileItem, addUrl: boolean) => {
  const { attributes, body } = previewLongFileContent(item.content || '');
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
