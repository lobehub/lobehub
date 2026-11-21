/**
 * The avatar picker reports a `data:` preview before an upload finishes, and
 * `null` when the avatar is deleted.
 */
export const isLocalAvatarPreview = (value: string | null) => !!value?.startsWith('data:');
