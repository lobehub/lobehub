import { splitCode, type SupportedLanguage } from '../../splitter';
import { loaderConfig } from '../config';

export const CodeLoader = async (text: string, language: string) => {
  return splitCode(text, language as SupportedLanguage, loaderConfig);
};
