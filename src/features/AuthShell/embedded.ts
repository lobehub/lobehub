import { LOBOT_EMBEDDED_AUTH_UA_TOKEN } from '@lobechat/const/desktop';

/**
 * Whether these auth pages run inside Lobot's in-app sign-in window. That window marks
 * its user agent, which stays the same on every page of the flow (sign in, sign up,
 * verify email, consent), unlike a query param that redirects would drop.
 */
export const isEmbeddedAuth = (userAgent?: string): boolean => {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return ua.includes(LOBOT_EMBEDDED_AUTH_UA_TOKEN);
};
