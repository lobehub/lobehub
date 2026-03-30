import { splitMarkdown } from '../../splitter';
import { loaderConfig } from '../config';

export const MarkdownLoader = async (text: string) => {
  return splitMarkdown(text, loaderConfig);
};
