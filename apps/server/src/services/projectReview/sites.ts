import { siteOriginMatches } from '@lobechat/utils/siteOrigin';

import { ProjectSiteModel } from '@/database/models/projectReview';
import type { LobeChatDatabase } from '@/database/type';

export async function findSiteForOrigin(
  db: LobeChatDatabase,
  siteId: string,
  origin: string | null | undefined,
) {
  if (!origin) return null;
  const site = await new ProjectSiteModel(db).findById(siteId);
  if (!site || !site.origins.some((pattern) => siteOriginMatches(pattern, origin))) return null;
  return site;
}
