declare module '@lobechat/database/test-utils' {
  import type { MarketDatabase } from '../types';

  export const getTestDB: () => Promise<MarketDatabase>;
}
