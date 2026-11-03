import { type DocumentChunk } from '../../types';

export const PPTXLoader = async (fileBlob: Blob | string): Promise<DocumentChunk[]> => {
  const { parseOfficeAsync } = await import('officeparser');

  const buffer =
    typeof fileBlob === 'string'
      ? Buffer.from(fileBlob)
      : Buffer.from(await fileBlob.arrayBuffer());

  const text = await parseOfficeAsync(buffer);

  return [
    {
      metadata: {},
      pageContent: text,
    },
  ];
};
