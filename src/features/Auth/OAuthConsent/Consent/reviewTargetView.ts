import type { OidcInteractionDetailsResponse } from '@/types/oidc';

export type ReviewTargetInput = NonNullable<OidcInteractionDetailsResponse['acceptanceReview']>;
type SiteRole = NonNullable<ReviewTargetInput['role']>;

export type ReviewTargetView =
  | { denied: boolean; kind: 'acceptance'; title: string }
  | { kind: 'site'; origin?: string; project: string; role?: SiteRole; site: string }
  | { kind: 'siteDenied' }
  | { kind: 'unregistered'; origin?: string };

export const reviewTargetView = (review: ReviewTargetInput): ReviewTargetView => {
  if (review.kind !== 'site')
    return { denied: !review.allowed, kind: 'acceptance', title: review.title ?? '' };
  if (review.allowed)
    return {
      kind: 'site',
      origin: review.origin,
      project: review.projectName ?? '',
      role: review.role ?? undefined,
      site: review.siteName ?? '',
    };
  return review.reason === 'unregistered'
    ? { kind: 'unregistered', origin: review.origin }
    : { kind: 'siteDenied' };
};
