import { splitText } from '../../splitter';
import { type DocumentChunk } from '../../types';
import { loaderConfig } from '../config';

export const DocxLoader = async (fileBlob: Blob | string): Promise<DocumentChunk[]> => {
  const mammoth = await import('mammoth');

  const buffer =
    typeof fileBlob === 'string'
      ? Buffer.from(fileBlob)
      : Buffer.from(await fileBlob.arrayBuffer());

  const result = await mammoth.extractRawText({ buffer });
  return splitText(result.value, loaderConfig);
};
