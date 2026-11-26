/**
 * Who owns an emoji pack.
 * - `user`: one person's pack, shown only in their picker.
 * - `workspace`: shared with every workspace member.
 */
export type EmojiPackScope = 'user' | 'workspace';

/**
 * - `favorites`: the implicit pack holding one person's loose saved emojis; one per person.
 * - `pack`: a named set, like a WeChat or Telegram sticker pack.
 */
export type EmojiPackKind = 'favorites' | 'pack';

/** `public` packs can be added by others through a share link. */
export type EmojiPackVisibility = 'private' | 'public';
