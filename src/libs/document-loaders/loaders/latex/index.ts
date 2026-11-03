import { splitLatex } from '../../splitter';
import { loaderConfig } from '../config';

export const LatexLoader = async (text: string) => {
  return splitLatex(text, loaderConfig);
};
