import {
  MAX_OAUTH_REDIRECT_URIS,
  normalizeRedirectUris,
  validateRedirectUri,
} from '@lobechat/utils/oauthApp';

export { MAX_OAUTH_REDIRECT_URIS, normalizeRedirectUris };

const ISSUE_MESSAGE_KEYS = {
  credentials: 'oauthApp.validation.redirectUri.credentials',
  fragment: 'oauthApp.validation.redirectUri.fragment',
  insecure: 'oauthApp.validation.redirectUri.insecure',
  malformed: 'oauthApp.validation.redirectUri.malformed',
  wildcard: 'oauthApp.validation.redirectUri.wildcard',
} as const;

/**
 * Message key for one row of the redirect URI editor, or `undefined` when the
 * value is acceptable. Blank rows pass here because saving drops them; the
 * list-level rule is what refuses a list with nothing left in it.
 */
export const redirectUriMessageKey = (value?: string) => {
  if (!value?.trim()) return undefined;

  const issue = validateRedirectUri(value);
  return issue ? ISSUE_MESSAGE_KEYS[issue] : undefined;
};

/**
 * Message key for the whole list, mirroring the server: a save needs at least
 * one redirect URI and no more than the cap.
 */
export const redirectUriListMessageKey = (values: (string | undefined)[] = []) => {
  const uris = normalizeRedirectUris(values.map((value) => value ?? ''));

  if (uris.length === 0) return 'oauthApp.validation.redirectUriRequired' as const;
  if (uris.length > MAX_OAUTH_REDIRECT_URIS)
    return 'oauthApp.validation.redirectUriTooMany' as const;

  return undefined;
};
