import { estimateTokenCount } from 'tokenx';

export const encodeAsync = async (str: string): Promise<number> => {
  if (str.length === 0) return 0;

  return estimateTokenCount(str);
};
