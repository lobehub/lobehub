import { type BaseSignUpFormValues } from '@/app/[variants]/(auth)/signup/[[...signup]]/types';

export interface BusinessSignupFomData {}

// eslint-disable-next-line unused-imports/no-unused-vars
export const useBusinessSignup = (form: any) => {
  return {
    businessElement: null,
    getFetchOptions: async () => {
      return {};
    },
    // eslint-disable-next-line unused-imports/no-unused-vars
    preSocialSignupCheck: async (values: BusinessSignupFomData & BaseSignUpFormValues) => {
      return true;
    },
  };
};
