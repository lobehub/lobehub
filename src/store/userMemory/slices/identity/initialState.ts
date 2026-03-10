import { type IdentityListItem, type IdentityListSort } from '@lobechat/types';

import { type IdentityForInjection } from '../../types';

export interface IdentitySliceState {
  /** Global identities fetched at app initialization for injection into chat context */
  globalIdentities: IdentityForInjection[];
  /** When global identities were fetched */
  globalIdentitiesFetchedAt?: number;
  /** Whether global identities have been initialized */
  globalIdentitiesInit: boolean;
  identities: IdentityListItem[];
  identitiesHasMore: boolean;
  identitiesInit: boolean;
  identitiesPage: number;
  identitiesQuery?: string;
  identitiesRelationships?: string[];
  identitiesSearchLoading?: boolean;
  identitiesSort?: IdentityListSort;
  identitiesTotal: number;
  identitiesTypes?: string[];
}

export const identityInitialState: IdentitySliceState = {
  globalIdentities: [],
  globalIdentitiesFetchedAt: undefined,
  globalIdentitiesInit: false,
  identities: [],
  identitiesHasMore: true,
  identitiesInit: false,
  identitiesPage: 1,
  identitiesQuery: undefined,
  identitiesRelationships: undefined,
  identitiesSort: undefined,
  identitiesTotal: 0,
  identitiesTypes: undefined,
};
