const noop = (() => {}) as any;

export const changeEmail = noop;
export const linkSocial = noop;
export const oauth2 = noop;
export const accountInfo = noop;
export const listAccounts = noop;
export const requestPasswordReset = noop;
export const resetPassword = noop;
export const sendVerificationEmail = noop;
export const signIn = noop;
export const signOut = noop;
export const signUp = noop;
export const unlinkAccount = noop;
export const useSession = () => ({
  data: null,
  error: null,
  isPending: false,
});
