import urlJoin from 'url-join';

/**
 * Resolve the community profile link for a resource author.
 *
 * Organization-owned resources link to the organization public page
 * (`/community/org/:slug`), while individual users link to the user
 * page (`/community/user/:slug`).
 */
export const resolveCommunityProfileLink = (
  userName: string,
  ownerType?: 'user' | 'organization',
): string => urlJoin(ownerType === 'organization' ? '/community/org' : '/community/user', userName);
