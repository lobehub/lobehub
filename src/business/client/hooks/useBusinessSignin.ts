export const useBusinessSignin = () => {
  return {
    getAdditionalData: async () => {
      return {};
    },
    preSocialSigninCheck: async () => {
      return true;
    },
    ssoProviders: [],
  };
};
