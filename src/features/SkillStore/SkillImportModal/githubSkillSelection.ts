import type { GitHubSkillCandidate } from '@lobechat/types';

export const canImportCandidate = ({ status }: GitHubSkillCandidate) =>
  status === 'new' || status === 'update';

export const getGithubSkillChoices = (
  candidates: GitHubSkillCandidate[],
  selected: string[],
  query: string,
  selectedOnly: boolean,
) => {
  const selectedPaths = new Set(selected);
  const selectedNames = new Set<string>();
  const eligibleNames = new Set<string>();
  const duplicateNames = new Set<string>();

  // Resolve collisions against the entire scan, including paths hidden by a search.
  for (const item of candidates) {
    const name = item.name.toLowerCase();
    if (selectedPaths.has(item.path)) selectedNames.add(name);
    if (!canImportCandidate(item)) continue;
    if (eligibleNames.has(name)) duplicateNames.add(name);
    eligibleNames.add(name);
  }

  const needle = query.trim().toLowerCase();
  const visible = selectedOnly
    ? candidates.filter((item) => selectedPaths.has(item.path))
    : candidates.filter(({ name, description, path }) =>
        [name, description, path].some((value) => value.toLowerCase().includes(needle)),
      );

  const bulkPaths = visible
    .filter((item) => canImportCandidate(item) && !duplicateNames.has(item.name.toLowerCase()))
    .map((item) => item.path);
  const checkedCount = bulkPaths.filter((path) => selectedPaths.has(path)).length;

  return { bulkPaths, checkedCount, duplicateNames, selectedNames, selectedPaths, visible };
};

export const toggleGithubSkillPaths = (selected: string[], paths: string[], checked: boolean) => {
  const next = new Set(selected);
  for (const path of paths) {
    if (checked) next.add(path);
    else next.delete(path);
  }
  return [...next];
};
