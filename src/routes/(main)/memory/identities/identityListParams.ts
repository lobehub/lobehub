import {
  DEFAULT_IDENTITY_LIST_PAGE_SIZE,
  type IdentityListParams,
} from '@/store/userMemory/slices/identity/projection';

/**
 * Head-page params of the identities list for the page's `q` / `type` URL
 * params. The route and its pre-paint loader both build them here, so the
 * loader hydrates exactly the persisted query the page then syncs.
 */
export const identityListParamsOf = (
  q: string | null | undefined,
  type: string | null | undefined,
): IdentityListParams => ({
  pageSize: DEFAULT_IDENTITY_LIST_PAGE_SIZE,
  q: q || undefined,
  types: !type || type === 'all' ? undefined : [type],
});
