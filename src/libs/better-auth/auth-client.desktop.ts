import {
  adminClient,
  genericOAuthClient,
  inferAdditionalFields,
  magicLinkClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { type auth } from '@/auth';

let _client: any = null;

const desktopAuthFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  return fetch(`${url.pathname}${url.search}`, init);
};

function getClient() {
  if (!_client) {
    _client = createAuthClient({
      // better-auth getBaseURL only accepts http(s); app://renderer throws.
      baseURL: 'http://lobehub.invalid',
      fetchOptions: {
        customFetchImpl: desktopAuthFetch,
      },
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
