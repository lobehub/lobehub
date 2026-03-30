import type { ReactNode } from 'react';

export const useBusinessSignin = () => {
  return {
    businessElement: null as ReactNode,
    getAdditionalData: async () => {
      return {};
    },
    getFetchOptions: async () => undefined as Record<string, any> | undefined,
    preSocialSigninCheck: async () => {
      return true;
    },
    ssoProviders: [],
  };
};
