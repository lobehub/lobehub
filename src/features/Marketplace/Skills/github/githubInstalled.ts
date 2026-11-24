import type { GitHubSkillUpstream, SkillListItem } from '@lobechat/types';

import { parseGithubSource } from './githubSource';

type InstalledSkill = Pick<SkillListItem, 'manifest' | 'source' | 'upstream'>;

/** The `https://github.com/…` folder a skill installed from GitHub tracks, or `null`. */
export const githubSkillUrl = (skill: InstalledSkill): string | null => {
  if (skill.source !== 'user') return null;
  const upstream: GitHubSkillUpstream | null | undefined = skill.upstream;
  if (upstream) {
    const base = `https://github.com/${upstream.owner}/${upstream.repo}`;
    return upstream.path ? `${base}/tree/${upstream.ref || 'HEAD'}/${upstream.path}` : base;
  }
  // Imports from before tracking only kept the address they came from.
  const sourceUrl = skill.manifest?.sourceUrl;
  return sourceUrl ? (parseGithubSource(sourceUrl)?.url ?? null) : null;
};

/** `owner/repo` of a skill installed from GitHub, for its row. */
export const githubSkillRepo = (skill: InstalledSkill): string | null => {
  const url = githubSkillUrl(skill);
  const source = url && parseGithubSource(url);
  return source ? `${source.owner}/${source.repo}` : null;
};
