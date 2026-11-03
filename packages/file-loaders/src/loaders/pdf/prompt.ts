import type { DocumentPage } from '../../types';

export const promptTemplate = (pages: DocumentPage[]) => {
  return pages
    .map((page, index) => {
      const pageNumber = page.metadata?.pageNumber || index;

      return `<page pageNumber="${pageNumber}">
${page.pageContent}
</page>`;
    })
    .join('\n\n');
};
