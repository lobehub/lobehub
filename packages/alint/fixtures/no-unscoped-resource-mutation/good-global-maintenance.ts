import { lt } from 'drizzle-orm';

import { db, publicCatalogCache } from './schema';

// System maintenance of shared public catalog cache; no user-owned data.
export const purgeExpiredCache = async (now: Date) =>
  db.delete(publicCatalogCache).where(lt(publicCatalogCache.expiresAt, now));
