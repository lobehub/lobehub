const DEFAULT_APP_HOME = 'https://lobehub.com';

/**
 * Build the redirect target for paths the Share router does not own.
 *
 * Preserves the path and query so exits like /signin?callbackUrl=… land on the
 * matching app route behind the shared gateway instead of the home page.
 */
export const buildAppExitUrl = (requestUrl: string, appHome?: string): string => {
  const { pathname, search } = new URL(requestUrl);

  return new URL(`${pathname}${search}`, appHome || DEFAULT_APP_HOME).toString();
};
