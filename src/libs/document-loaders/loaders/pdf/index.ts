import { splitPdf } from '../../splitter';
import { type DocumentChunk } from '../../types';
import { loaderConfig } from '../config';

export const PdfLoader = async (fileBlob: Blob): Promise<DocumentChunk[]> => {
  const pdfParse = (await import('pdf-parse')).default;

  // PDF.js 1.x drops byteOffset when it creates substreams. Its worker clones
  // Buffers into Node's pool, so even a zero-offset Buffer can be misread.
  // A plain Uint8Array keeps the worker copy outside that pool.
  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  // pdf-parse's types only declare Buffer; its PDF.js entry accepts Uint8Array.
  const parse = pdfParse as (data: Uint8Array) => ReturnType<typeof pdfParse>;
  const data = await parse(bytes);

  // Split into physical pages using form feed (\f),
  // then recursively chunk each page's text while preserving page numbers.
  return splitPdf(data.text, loaderConfig);
};
