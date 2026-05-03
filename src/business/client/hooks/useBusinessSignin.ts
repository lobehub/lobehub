import type { ReactNode } from 'react';

export const useBusinessSignin = () => {
  return {
    businessElement: null as ReactNode,
    getAdditionalData: async () => {
      return {};
    },
    // eslint-disable-next-line unused-imports/no-unused-vars
    getCaptchaTokenOnError: async (error: unknown) => undefined as string | null | undefined,
    getFetchOptions: async () => undefined as Record<string, unknown> | undefined,
    preSocialSigninCheck: async () => {
      return true;
    },
    ssoProviders: [],
  };
};
