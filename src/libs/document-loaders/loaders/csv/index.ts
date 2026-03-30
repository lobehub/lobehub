import { type DocumentChunk } from '../../types';

export const CsVLoader = async (fileBlob: Blob): Promise<DocumentChunk[]> => {
  const { dsvFormat } = await import('d3-dsv');
  const csvParse = dsvFormat(',');

  const text = await fileBlob.text();
  const rows = csvParse.parse(text);

  return rows.map((row, index) => {
    const content = Object.entries(row)
      .filter(([key]) => key !== 'columns')
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    return {
      metadata: {
        line: index + 1,
        source: 'blob',
      },
      pageContent: content,
    };
  });
};
