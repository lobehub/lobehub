import { Skeleton, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useQuery } from '@tanstack/react-query';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

import { useSkillsNav } from '../useSkillsNav';
import { githubSkillUrl } from './githubInstalled';
import { GithubRepoRow, GithubSkillRow } from './GithubRows';
import { GithubSearchLimitError, searchGithubRepos } from './searchGithubRepos';
import { useGithubSkillUpdates } from './useGithubSkillUpdates';

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    columnGap: 16,
    rowGap: 4,
  },
});

/** Skills in the library that were installed from GitHub, with the address each tracks. */
export const useInstalledGithubSkills = (query = '') => {
  const skills = useToolStore(agentSkillsSelectors.getUserAgentSkills);
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.flatMap((skill) => {
      const url = githubSkillUrl(skill);
      if (!url) return [];
      if (q && ![skill.name, skill.description ?? '', url].some((v) => v.toLowerCase().includes(q)))
        return [];
      return [{ skill, url }];
    });
  }, [query, skills]);
};

/**
 * The installed GitHub skills as rows. Opening the group checks GitHub once for
 * newer versions; a row with one offers Update.
 */
export const InstalledGithubSkills = memo<{ items: ReturnType<typeof useInstalledGithubSkills> }>(
  ({ items }) => {
    const { setGithubUrl } = useSkillsNav();
    const { data: checks } = useGithubSkillUpdates(items.length > 0);
    return (
      <div {...stylex.props(styles.grid)}>
        {items.map(({ skill, url }) => (
          <GithubSkillRow
            check={checks?.[skill.id]}
            key={skill.id}
            skill={skill}
            onOpen={() => setGithubUrl(url)}
          />
        ))}
      </div>
    );
  },
);

InstalledGithubSkills.displayName = 'MarketInstalledGithubSkills';

/**
 * Public GitHub repositories matching a search, each opening its import page.
 * GitHub allows ten anonymous searches a minute, so the query is the debounced
 * one and an answer is kept for five minutes.
 */
export const GithubSearchResults = memo<{ query: string }>(({ query }) => {
  const { t } = useTranslation('setting');
  const { setGithubUrl } = useSkillsNav();
  const { data, error, isLoading } = useQuery({
    enabled: query.trim().length >= 2,
    queryFn: ({ signal }) => searchGithubRepos(query, { signal }),
    queryKey: ['market', 'githubSkillRepos', query.trim().toLowerCase()],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Skeleton.Text rows={2} />;
  if (error)
    return (
      <Text type={'secondary'}>
        {t(
          error instanceof GithubSearchLimitError
            ? 'market.skills.github.searchLimited'
            : 'market.skills.github.searchFailed',
        )}
      </Text>
    );
  if (!data?.length) return <Text type={'secondary'}>{t('market.skills.github.searchEmpty')}</Text>;

  return (
    <div {...stylex.props(styles.grid)}>
      {data.map((hit) => (
        <GithubRepoRow hit={hit} key={hit.fullName} onOpen={() => setGithubUrl(hit.url)} />
      ))}
    </div>
  );
});

GithubSearchResults.displayName = 'MarketGithubSearchResults';
