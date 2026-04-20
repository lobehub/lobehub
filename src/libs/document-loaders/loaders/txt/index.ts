import { splitText } from '../../splitter';
import { loaderConfig } from '../config';

export const TextLoader = async (text: string) => {
  return splitText(text, loaderConfig);
};
