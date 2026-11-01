const IMAGE_SOURCE_PATTERN = /^(?:https?:\/\/|\/|data:image\/)/i;

export const openFilePicker = (input: HTMLInputElement): void => {
  try {
    input.showPicker();
  } catch {
    input.click();
  }
};

/**
 * Agent `backgroundColor` historically stored CSS colors. It now stores the
 * profile cover image without requiring a database migration. Only image-like
 * sources are accepted, so legacy colors quietly resolve to no cover.
 */
export const resolveAgentBackground = (value?: string | null): string | undefined => {
  const source = value?.trim();

  return source && IMAGE_SOURCE_PATTERN.test(source) ? source : undefined;
};

/**
 * Remount key for any avatar rendered through `@lobehub/ui`'s `Avatar`.
 *
 * That component latches an internal `isImgError` on the first failed image
 * load and never clears it when `avatar` changes, so once an avatar url breaks
 * (deleted object, expired signature, a transient 5xx) every later avatar in
 * that mount stays invisible until a reload. Keying by the url remounts with a
 * clean error state exactly when the source changes, and keeps the identity
 * stable across unrelated re-renders so nothing flickers.
 */
export const avatarRemountKey = (avatar?: string | null): string => avatar || 'empty';
