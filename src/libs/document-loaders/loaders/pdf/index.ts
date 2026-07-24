import { splitPdf } from '../../splitter';
import { type DocumentChunk } from '../../types';
import { assertWithinLoaderLimit, loaderConfig, MAX_PDF_PAGES } from '../config';

export const PdfLoader = async (fileBlob: Blob): Promise<DocumentChunk[]> => {
  const pdfParse = (await import('pdf-parse')).default;

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const data = await pdfParse(buffer);
  assertWithinLoaderLimit(data.numpages, MAX_PDF_PAGES, 'PDF page count');

  // Split into physical pages using form feed (\f),
  // then recursively chunk each page's text while preserving page numbers.
  return splitPdf(data.text, loaderConfig);
};
