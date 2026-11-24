import type { SkillListItem } from '@lobechat/types';

import { githubSkillUrl } from './github/githubInstalled';

type LibrarySkill = Pick<
  SkillListItem,
  'description' | 'manifest' | 'name' | 'source' | 'upstream'
>;

/**
 * The user's own skills with no GitHub origin: written by hand, created through
 * `lh skill create` or an agent, or imported from a URL or ZIP. Neither the
 * market's "Installed" group nor "From GitHub" lists them.
 */
export const customSkillsOf = <T extends LibrarySkill>(skills: T[], query = ''): T[] => {
  const q = query.trim().toLowerCase();
  return skills.filter(
    (skill) =>
      skill.source === 'user' &&
      !githubSkillUrl(skill) &&
      (!q || [skill.name, skill.description ?? ''].some((v) => v.toLowerCase().includes(q))),
  );
};
