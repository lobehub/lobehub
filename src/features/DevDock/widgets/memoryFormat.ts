import { formatSize } from '@/utils/format';

export const formatCompactSize = (bytes: number) =>
  formatSize(bytes).replace(' ', '').replace('B', '');
