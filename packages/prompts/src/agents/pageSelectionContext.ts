import type { PageSelection } from '@lobechat/types';

/**
 * Format page selections into a system prompt context
 * Each selection is wrapped in a <selection> tag with metadata
 */
export const formatPageSelections = (selections: PageSelection[]): string => {
  if (!selections || selections.length === 0) {
    return '';
  }

  const formattedSelections = selections
    .map((sel) => {
      const lineInfo =
        sel.startLine !== undefined
          ? ` lines="${sel.startLine}-${sel.endLine ?? sel.startLine}"`
          : '';

      return `<selection ${lineInfo}>
${sel.xml}
</selection>`;
    })
    .join('\n');

  return `<user_selections count="${selections.length}">
${formattedSelections}
</user_selections>`;
};
