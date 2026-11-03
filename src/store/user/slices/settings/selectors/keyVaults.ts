import { type UserStore } from '@/store/user';
import { type UserKeyVaults } from '@/types/user/settings';

import { currentSettings } from './settings';

export const keyVaultsSettings = (s: UserStore): UserKeyVaults =>
  currentSettings(s).keyVaults || {};

const getVaultByProvider = (provider: string) => (s: UserStore) =>
  // @ts-ignore
  (keyVaultsSettings(s)[provider] || {}) as any;

export const keyVaultsConfigSelectors = {
  getVaultByProvider,
  keyVaultsSettings,
};
