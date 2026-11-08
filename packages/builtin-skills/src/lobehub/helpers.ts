import type { SkillResourceMeta } from '@lobechat/types';
import { parseDocument } from 'yaml';
import { z } from 'zod';

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

/** Matches only the leading YAML frontmatter block of a `SKILL.md`. */
const FRONTMATTER_BLOCK = /^---\r?\n([\S\s]*?)\r?\n---/;

const skillVersionSchema = z.object({
  metadata: z.object({ version: z.string().optional() }).optional(),
  version: z.string().optional(),
});

/** Read Agent Skills metadata.version, with support for legacy top-level version. */
export const readSkillVersion = (content: string): string | undefined => {
  const block = FRONTMATTER_BLOCK.exec(content)?.[1];
  if (!block) return undefined;

  const document = parseDocument(block);
  if (document.errors.length > 0) return undefined;
  const result = skillVersionSchema.safeParse(document.toJS());
  if (!result.success) return undefined;
  return (result.data.metadata?.version ?? result.data.version)?.trim() || undefined;
};
