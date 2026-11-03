import type { ExistingLink, PeekedToken } from './shared';

export const isSingleAccountRebindBlocked = (
  existingLink?: ExistingLink | null,
  tokenData?: PeekedToken | null,
): boolean =>
  !!(
    existingLink &&
    tokenData &&
    existingLink.platformUserId &&
    existingLink.platformUserId !== tokenData.platformUserId
  );

export const shouldShowSingleAccountSuccess = (
  existingLink?: ExistingLink | null,
  tokenData?: PeekedToken | null,
  done?: boolean,
): boolean => {
  if (done) return true;
  if (!existingLink) return false;
  if (!tokenData) return true;

  return existingLink.platformUserId === tokenData.platformUserId;
};
