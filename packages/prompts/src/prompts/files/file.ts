import type { ChatFileItem } from '@lobechat/types';

import {
  formatTextWindowAttributes,
  formatTextWindowNotice,
  sliceTextWindow,
} from '../../textWindow';
import { readKnowledgeContinuation } from '../knowledgeBaseQA/formatFileContents';

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

export interface PreviewLongFileContentOptions {
  /** File id the model passes to `readKnowledge` to page through the rest. */
  fileId: string;
  /** Original character count when the stored text was cut at parse time. */
  originalChars?: number;
}

/**
 * Inline a file's text, or replace it with a preview when it exceeds `FILE_INLINE_MAX_CHARS` or
 * its stored text is known to be incomplete. The preview uses the shared text-window contract:
 * attributes report the window and full size, and the notice names the exact `readKnowledge` call
 * for the next window. The runtime enables `readKnowledge` whenever such a preview is sent.
 */
export const previewLongFileContent = (
  content: string,
  { fileId, originalChars }: PreviewLongFileContentOptions,
) => {
  const storedCut = originalChars !== undefined && originalChars > content.length;
  if (content.length <= FILE_INLINE_MAX_CHARS && !storedCut) {
    return { attributes: '', body: content };
  }

  const window = sliceTextWindow(content, { maxChars: FILE_PREVIEW_CHARS });
  const options = { continueFrom: readKnowledgeContinuation(fileId), originalChars };
  const notice = formatTextWindowNotice(window, options);

  return {
    attributes: formatTextWindowAttributes(window, options),
    body: `${window.content}
[This is a preview, not the complete file. Do not ask the user to paste the rest.]${notice ? `\n${notice}` : ''}`,
  };
};

const filePrompt = (item: ChatFileItem, addUrl: boolean) => {
  const { attributes, body } = previewLongFileContent(item.content || '', {
    fileId: item.id,
    originalChars: item.originalCharCount,
  });
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
