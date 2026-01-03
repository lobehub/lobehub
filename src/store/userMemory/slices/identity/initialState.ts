import { type DisplayIdentityMemory } from '@/database/repositories/userMemory';
import type { TypesEnum } from '@/types/userMemory';

import type { IdentityForInjection } from '../../types';

export interface IdentitySliceState {
  /** Global identities fetched at app initialization for injection into chat context */
  globalIdentities: IdentityForInjection[];
  /** When global identities were fetched */
  globalIdentitiesFetchedAt?: number;
  /** Whether global identities have been initialized */
  globalIdentitiesInit: boolean;
  identities: DisplayIdentityMemory[];
  identitiesHasMore: boolean;
  identitiesInit: boolean;
  identitiesPage: number;
  identitiesQuery?: string;
  identitiesSearchLoading?: boolean;
  identitiesTotal: number;
  identitiesTypes?: TypesEnum[];
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
  identitiesTotal: 0,
  identitiesTypes: undefined,
};
