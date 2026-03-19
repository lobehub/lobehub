import type { SkillResourceMeta } from '@lobechat/types';

/**
 * Convert a simple path→content map to Record<string, SkillResourceMeta>.
 */
export const toResourceMeta = (
  resources: Record<string, string>,
): Record<string, SkillResourceMeta> => {
  return Object.fromEntries(
    Object.entries(resources).map(([path, content]) => [
      path,
      {
        content,
        fileHash: '',
        size: new TextEncoder().encode(content).length,
      },
    ]),
  );
};
