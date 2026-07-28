export const DEV_AUTH_BYPASS_HEADER = 'lobe-auth-dev-backend-api';

const MIN_DEV_AUTH_BYPASS_TOKEN_LENGTH = 32;

export const getDevAuthBypassToken = (): string | undefined => {
  const token = process.env.DEV_AUTH_BYPASS_SECRET;

  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.ENABLE_DEV_AUTH_BYPASS !== '1' ||
    !token ||
    token.length < MIN_DEV_AUTH_BYPASS_TOKEN_LENGTH
  ) {
    return undefined;
  }

  return token;
};

export const isDevAuthBypassRequest = (headers: Headers): boolean => {
  const expectedToken = getDevAuthBypassToken();
  const requestToken = headers.get(DEV_AUTH_BYPASS_HEADER);

  return !!expectedToken && requestToken === expectedToken;
};
