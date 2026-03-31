import { type DocumentChunk } from '../../types';

export const PdfLoader = async (fileBlob: Blob): Promise<DocumentChunk[]> => {
  const pdfParse = (await import('pdf-parse')).default;

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const data = await pdfParse(buffer);

  // Split by pages using form feed character, or treat as single page
  const pages: string[] = data.text
    ? data.text.split(/\f/).filter((page: string) => page.trim().length > 0)
    : [];

  return pages.map((pageContent: string, index: number) => ({
    metadata: {
      loc: { pageNumber: index + 1 },
    },
    pageContent: pageContent.trim(),
  }));
};
