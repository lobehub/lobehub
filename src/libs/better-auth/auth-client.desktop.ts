import {
  adminClient,
  genericOAuthClient,
  inferAdditionalFields,
  magicLinkClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { type auth } from '@/auth';
import { electronSyncSelectors } from '@/store/electron/selectors/sync';
import { getElectronStoreState } from '@/store/electron/store';

let _client: any = null;

function getClient() {
  if (!_client) {
    const baseURL = electronSyncSelectors.remoteServerUrl(getElectronStoreState());

    _client = createAuthClient({
      baseURL,
      plugins: [
        adminClient(),
        inferAdditionalFields<typeof auth>(),
        genericOAuthClient(),
        magicLinkClient(),
      ],
    });
  }
  return _client;
}

function lazyProp(key: string): any {
  // Target must be a function for the Proxy apply trap to work
  return new Proxy(function () {}, {
    apply(_t, thisArg, args) {
      return Reflect.apply(getClient()[key], thisArg, args);
    },
    get(_t, prop, receiver) {
      const target = getClient()[key];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export const changeEmail = lazyProp('changeEmail');
export const linkSocial = lazyProp('linkSocial');
export const oauth2 = lazyProp('oauth2');
export const accountInfo = lazyProp('accountInfo');
export const listAccounts = lazyProp('listAccounts');
export const requestPasswordReset = lazyProp('requestPasswordReset');
export const resetPassword = lazyProp('resetPassword');
export const sendVerificationEmail = lazyProp('sendVerificationEmail');
export const signIn = lazyProp('signIn');
export const signOut = lazyProp('signOut');
export const signUp = lazyProp('signUp');
export const unlinkAccount = lazyProp('unlinkAccount');
export const useSession = lazyProp('useSession');

/**
 * Passkeys are bound to the rpID derived from the web origin, so the desktop
 * shell cannot use credentials enrolled in the browser. The UI already hides
 * itself with `!isDesktop`, but the module is still resolved by the renderer
 * build, so these have to exist as real exports.
 */
export const useListPasskeys = () => ({
  data: [] as never[],
  isPending: false,
  refetch: async () => {},
});

const passkeyUnavailable = async () => ({
  error: { message: 'Passkeys are not available in the desktop app.' },
});

export const passkey = {
  addPasskey: passkeyUnavailable,
  deletePasskey: passkeyUnavailable,
  updatePasskey: passkeyUnavailable,
};
