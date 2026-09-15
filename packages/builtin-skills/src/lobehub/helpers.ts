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

/** Matches only the leading YAML frontmatter block of a `SKILL.md`. */
const FRONTMATTER_BLOCK = /^---\r?\n([\S\s]*?)\r?\n---/;

/**
 * Read a skill's declared `version` out of its `SKILL.md` frontmatter.
 *
 * The frontmatter is the single source of truth: the same file is what gets
 * materialized onto a builder's disk, so an installed copy always carries the
 * version it was installed at — which is what makes an install-time
 * "your copy is N, latest is M" comparison possible without a side-car marker
 * file that can drift from the content it describes.
 *
 * Deliberately a small regex rather than a YAML parser: this package is imported
 * by the server, the CLI, and the desktop workspace stub, and one scalar field
 * does not justify a parser dependency in all three. The key must sit at column
 * zero, so an indented `version:` inside a block scalar (`description: >`) is
 * correctly ignored.
 */
export const readSkillVersion = (content: string): string | undefined => {
  const block = FRONTMATTER_BLOCK.exec(content)?.[1];
  if (!block) return undefined;

  const line = block.split(/\r?\n/).find((entry) => entry.startsWith('version:'));
  const value = line
    ?.slice('version:'.length)
    .trim()
    .replaceAll(/^['"]|['"]$/g, '');

  return value || undefined;
};
