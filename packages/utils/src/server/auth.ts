import { headers } from 'next/headers';

import { auth } from '@/auth';

export const getUserAuth = async () => {
  const currentHeaders = await headers();
  const requestHeaders = Object.fromEntries(currentHeaders.entries());

  const session = await auth.api.getSession({
    headers: requestHeaders,
  });

  const userId = session?.user?.id;

  return { betterAuth: session, userId };
};

/**
 * Extract Bearer Token from authorization header
 * @param authHeader - Authorization header (e.g. "Bearer xxx")
 * @returns Bearer Token or null (if authorization header is invalid or does not exist)
 */
export const extractBearerToken = (authHeader?: string | null): string | null => {
  if (!authHeader) return null;

  const trimmedHeader = authHeader.trim(); // Trim leading/trailing spaces

  // Check if it starts with 'Bearer ' (case-insensitive check might be desired depending on spec)
  if (!trimmedHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  // Extract the token part after "Bearer " and trim potential spaces around the token itself
  const token = trimmedHeader.slice(7).trim();

  // Return the token only if it's not an empty string after trimming
  return token || null;
};

/**
 * Extract JWT token from Oidc-Auth header
 * @param authHeader - Oidc-Auth header value (e.g. "Oidc-Auth xxx")
 * @returns JWT token or null (if authorization header is invalid or does not exist)
 */
export const extractOidcAuthToken = (authHeader?: string | null): string | null => {
  if (!authHeader) return null;

  const trimmedHeader = authHeader.trim(); // Trim leading/trailing spaces

  // Check if it starts with 'Oidc-Auth ' (case-insensitive check)
  if (!trimmedHeader.toLowerCase().startsWith('oidc-auth ')) {
    return null;
  }

  // Extract the token part after "Oidc-Auth " and trim potential spaces around the token itself
  const token = trimmedHeader.slice(10).trim(); // 'Oidc-Auth ' length is 10

  // Return the token only if it's not an empty string after trimming
  return token || null;
};
