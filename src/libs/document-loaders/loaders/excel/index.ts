import type { CellValue } from 'exceljs';

import type { DocumentChunk } from '../../types';

const cellToText = (value: CellValue): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((run) => run.text).join('');
    if ('formula' in value || 'sharedFormula' in value) return cellToText(value.result);
    if ('text' in value) return value.text;
    if ('error' in value) return value.error;

    return '';
  }

  return String(value);
};

/**
 * Chunks a `.xlsx` workbook into one document per data row, reusing the sheet's
 * first non-empty row as the column names — the same `header: value` shape `CsVLoader`
 * emits, so tabular data reaches the index identically whichever format it was
 * uploaded in.
 */
export const ExcelLoader = async (fileBlob: Blob): Promise<DocumentChunk[]> => {
  const { Workbook } = await import('exceljs');

  const workbook = new Workbook();
  await workbook.xlsx.load(await fileBlob.arrayBuffer());

  return workbook.worksheets.flatMap((sheet) => {
    const chunks: DocumentChunk[] = [];
    const headers = new Map<number, string>();
    let hasHeader = false;

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (!hasHeader) {
        row.eachCell({ includeEmpty: false }, (cell, column) => {
          headers.set(column, cellToText(cell.value));
        });
        hasHeader = true;
        return;
      }

      const lines: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        const value = cellToText(cell.value);
        if (value.trim() === '') return;

        lines.push(`${headers.get(column) || `column ${column}`}: ${value}`);
      });
      const content = lines.join('\n');

      if (!content) return;

      chunks.push({
        metadata: { row: rowNumber, sheetName: sheet.name, source: 'blob' },
        pageContent: content,
      });
    });

    return chunks;
  });
};
