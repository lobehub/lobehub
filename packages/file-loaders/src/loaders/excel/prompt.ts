import type { DocumentPage } from '../../types';

export const promptTemplate = (pages: DocumentPage[]) => {
  return (
    pages
      .map((page, index) => {
        const sheetName = page.metadata.sheetName;

        const sheetIndex = page.metadata?.pageNumber || index;

        return `<sheet name="${sheetName}" index="${sheetIndex}">
${page.pageContent}
</sheet>`;
      })
      // Separator between sheets
      .join('\n\n')
  );
};
