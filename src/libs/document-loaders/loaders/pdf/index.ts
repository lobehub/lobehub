import { splitPdf } from '../../splitter';
import { type DocumentChunk } from '../../types';
import { loaderConfig } from '../config';

export const PdfLoader = async (fileBlob: Blob): Promise<DocumentChunk[]> => {
  const pdfParse = (await import('pdf-parse')).default;

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const data = await pdfParse(buffer);

  // Split into physical pages using form feed (\f),
  // then recursively chunk each page's text while preserving page numbers.
  return splitPdf(data.text, loaderConfig);
};
