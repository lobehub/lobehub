import type { ShareVisitorTopicGroup } from '@lobechat/types';

/** The most recently active visitor topic across all visitors, which the visitors page opens on. */
export const getLatestVisitorTopicId = (groups: ShareVisitorTopicGroup[]): string | undefined => {
  let latest: { id: string; updatedAt: number } | undefined;
  for (const group of groups) {
    for (const topic of group.topics) {
      const updatedAt = new Date(topic.updatedAt).getTime();
      if (!latest || updatedAt > latest.updatedAt) latest = { id: topic.id, updatedAt };
    }
  }
  return latest?.id;
};

const SHARE_VISITOR_ROUTE = /^(?:\/[^/]+)?\/agent\/[^/]+\/visitor(?:\/[^/]+)?\/?$/;

/**
 * Whether the URL is the visitors page or one of its topics, where the sidebar lists visitors
 * instead of the Agent's own topics. Anchored on the Agent subroute, with an optional workspace slug.
 */
export const isShareVisitorRoute = (pathname: string) =>
  SHARE_VISITOR_ROUTE.test(pathname.replace(/^\/_dangerous_local_dev_proxy(?=\/)/, ''));
