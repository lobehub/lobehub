import type { ReactNode } from 'react';

export const useBusinessSignin = () => {
  return {
    businessElement: null as ReactNode,
    getAdditionalData: async () => {
      return {};
    },
    getCaptchaTokenOnError: async (_error: unknown) => undefined as string | null | undefined,
    getFetchOptions: async () => undefined as Record<string, unknown> | undefined,
    preSocialSigninCheck: async () => {
      return true;
    },
    ssoProviders: [],
  };
};
