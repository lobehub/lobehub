import { EPubLoader as Loader } from '@langchain/community/document_loaders/fs/epub';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

import { TempFileManager } from '@/server/utils/tempFileManager';
import { nanoid } from '@/utils/uuid';

import { loaderConfig } from '../config';

export const EPubLoader = async (content: Uint8Array) => {
  const tempManager = new TempFileManager('epub-');

  try {
    const tempPath = await tempManager.writeTempFile(content, `${nanoid()}.epub`);
    const loader = new Loader(tempPath);
    const documents = await loader.load();

    const splitter = new RecursiveCharacterTextSplitter(loaderConfig);
    return await splitter.splitDocuments(documents);
  } catch (e) {
    throw new Error(`EPubLoader error: ${(e as Error).message}`);
  } finally {
    tempManager.cleanup(); // Ensure cleanup
  }
};
