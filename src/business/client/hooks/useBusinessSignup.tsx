import type { BaseSignUpFormValues } from '@/features/Auth/SignUp/types';

export interface BusinessSignupFomData {}

export const useBusinessSignup = (_form: any) => {
  return {
    businessElement: null,
    getCaptchaTokenOnError: async (_error: unknown) => undefined as string | null | undefined,
    getFetchOptions: async () => {
      return {};
    },
    preSocialSignupCheck: async (_values: BusinessSignupFomData & BaseSignUpFormValues) => {
      return true;
    },
  };
};
