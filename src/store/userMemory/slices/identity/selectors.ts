import { type UserMemoryStoreState } from '../../initialState';
import { type IdentityForInjection } from '../../types';

export const identitySelectors = {
  /**
   * Get global identities for chat context injection
   */
  globalIdentities: (state: UserMemoryStoreState): IdentityForInjection[] => state.globalIdentities,

  /**
   * Check if global identities have been initialized
   */
  globalIdentitiesInit: (state: UserMemoryStoreState): boolean => state.globalIdentitiesInit,

  /**
   * Check if there are any global identities
   */
  hasGlobalIdentities: (state: UserMemoryStoreState): boolean => state.globalIdentities.length > 0,
};
