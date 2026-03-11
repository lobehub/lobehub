import { type SupportedTextSplitterLanguage } from 'langchain/text_splitter';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

import { loaderConfig } from '@/libs/langchain/loaders/config';

export const CodeLoader = async (text: string, language: string) => {
  const splitter = RecursiveCharacterTextSplitter.fromLanguage(
    language as SupportedTextSplitterLanguage,
    loaderConfig,
  );

  return await splitter.createDocuments([text]);
};
