/**
 * One version's `SKILL.md` as a plan skill kept it — frontmatter included, as
 * the document view shows it. A payload without `versions` (an older server)
 * has none to offer, rather than throwing.
 */
export const skillVersionContent = (
  versions: readonly { content: string; version: number }[] | null | undefined,
  revision: number,
): string | undefined => (versions ?? []).find((version) => version.version === revision)?.content;
