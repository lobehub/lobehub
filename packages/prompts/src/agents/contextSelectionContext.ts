import { MCP_APP_CONTEXT_MAX_LENGTH } from '@lobechat/const/mcpApp';
import type { ContextSelection } from '@lobechat/types';

import { escapeXmlAttr, escapeXmlContent } from '../prompts/search/xmlEscape';

const formatLineRange = (selection: ContextSelection): string => {
  const range = selection.lineRange;
  if (!range) return '';

  return ` lines="${range.startLine}-${range.endLine ?? range.startLine}"`;
};

const formatPageRange = (selection: ContextSelection): string => {
  if (selection.source !== 'file' || !selection.pageRange) return '';

  const { endPage, startPage } = selection.pageRange;
  if (endPage === undefined || endPage === startPage) return ` page="${startPage}"`;

  return ` pages="${startPage}-${endPage}"`;
};

const formatSelectionAttributes = (selection: ContextSelection): string => {
  const attrs = [`source="${selection.source}"`];

  if (selection.title) attrs.push(`title="${escapeXmlAttr(selection.title)}"`);
  if (selection.source === 'mcpApp')
    attrs.push(`identifier="${escapeXmlAttr(selection.identifier)}"`);
  if (selection.source === 'page') attrs.push(`pageId="${escapeXmlAttr(selection.pageId)}"`);
  if (selection.source === 'file') attrs.push(`fileId="${escapeXmlAttr(selection.fileId)}"`);
  if (selection.source === 'code') {
    attrs.push(`filePath="${escapeXmlAttr(selection.filePath)}"`);
    if (selection.language) attrs.push(`language="${escapeXmlAttr(selection.language)}"`);
    if (selection.side) attrs.push(`side="${selection.side}"`);
    if (selection.workingDirectory) {
      attrs.push(`workingDirectory="${escapeXmlAttr(selection.workingDirectory)}"`);
    }
  }

  return `${attrs.join(' ')}${formatLineRange(selection)}${formatPageRange(selection)}`;
};

const getSelectionBody = (selection: ContextSelection): string => {
  if (selection.source === 'mcpApp')
    return escapeXmlContent(selection.content.slice(0, MCP_APP_CONTEXT_MAX_LENGTH));
  // Text lifted from a document the user did not write, so it must not be able
  // to close the container and pose as instructions.
  if (selection.source === 'file') return escapeXmlContent(selection.content);
  if (selection.source === 'page' && selection.xml) {
    if (!selection.content || selection.content === selection.xml) return selection.xml;

    return `<selected_text>${escapeXmlContent(selection.content)}</selected_text>
<containing_blocks>
${selection.xml}
</containing_blocks>`;
  }

  return selection.content;
};

/**
 * Format generic context selections into a system prompt context.
 * Each selection carries source metadata so non-page selections, such as code
 * diff lines, can be injected without overloading PageSelection.
 */
export const formatContextSelections = (selections: ContextSelection[]): string => {
  if (!selections || selections.length === 0) return '';

  const formattedSelections = selections
    .map(
      (selection) => `<context_selection ${formatSelectionAttributes(selection)}>
${getSelectionBody(selection)}
</context_selection>`,
    )
    .join('\n');

  return `<user_context_selections count="${selections.length}">
${formattedSelections}
</user_context_selections>`;
};
