/**
 * The avatar for the share image header. A header agent without an avatar of
 * its own draws its generated character, so the current agent's avatar only
 * stands in when there is no header agent at all.
 */
export const resolveHeaderAvatar = (
  headerMeta: { avatar?: string } | undefined,
  currentAvatar: string | undefined,
): string | undefined => (headerMeta ? headerMeta.avatar : currentAvatar);
