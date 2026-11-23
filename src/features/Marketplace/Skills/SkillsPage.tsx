import { ActionIcon, Button, Center, Flexbox, SearchBar, Text } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useDebounce, useInViewport } from 'ahooks';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { SkillCategory, SkillSorts } from '@/types/discover';

import BackLink from './BackLink';
import GithubImportPage from './github/GithubImportPage';
import { GithubAddressRow } from './github/GithubRows';
import {
  GithubSearchResults,
  InstalledGithubSkills,
  useInstalledGithubSkills,
} from './github/GithubSkillGroups';
import { parseGithubSource } from './github/githubSource';
import { RowGridSkeleton, SectionSkeleton } from './MarketSkeleton';
import SkillRow, { type SkillSummary } from './SkillRow';
import { useSkillsNav } from './useSkillsNav';

/** Rows a group previews before its "all" arrow. */
const PREVIEW_COUNT = 6;
const PAGE_SIZE = 40;
/** The `skillGroup` of the installed skills' own page. */
const INSTALLED_GROUP = 'installed';

const styles = stylex.create({
  divider: {
    height: 1,
    backgroundColor: cssVar.colorBorderSecondary,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    columnGap: 16,
    rowGap: 4,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: 8,
  },
  headerLink: {
    cursor: 'pointer',
  },
});

const matches = (skill: SkillSummary, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [skill.name, skill.identifier, skill.description ?? ''].some((text) =>
    text.toLowerCase().includes(q),
  );
};

/** The market skills already in the library, as rows. */
const useInstalledSkills = () => {
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  useFetchAgentSkills(true);
  const installed = useToolStore(agentSkillsSelectors.getMarketAgentSkills);
  return useMemo<SkillSummary[]>(
    () =>
      installed.map((skill) => ({
        description: skill.description,
        identifier: skill.identifier,
        name: skill.name,
      })),
    [installed],
  );
};

/** A market query's rows, its total and the paging flags. */
const useMarketSkills = (
  params: { category?: string; q?: string },
  pageSize: number,
  enabled = true,
) => {
  const useSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const { isLoading, queryKey } = useSkillList(
    {
      page: 1,
      pageSize,
      ...params,
      sort: params.q ? SkillSorts.Relevance : SkillSorts.InstallCount,
    },
    { enabled },
  );
  const list = useDiscoverStore(skillSelectors.skillList(queryKey));
  return { isLoading, items: list?.items ?? [], total: list?.totalCount ?? 0 };
};

/** Rows in two columns; `withAgents` (the installed skills) shows how many assistants have each on. */
const SkillGrid = memo<{ skills: SkillSummary[]; withAgents?: boolean }>(
  ({ skills, withAgents = false }) => {
    const { openSkill } = useSkillsNav();
    return (
      <div {...stylex.props(styles.grid)}>
        {skills.map((skill) => (
          <SkillRow
            key={skill.identifier}
            showAgents={withAgents}
            skill={skill}
            onOpen={() => openSkill(skill.identifier)}
          />
        ))}
      </div>
    );
  },
);

SkillGrid.displayName = 'MarketSkillGrid';

const GridSkeleton = () => <RowGridSkeleton count={PREVIEW_COUNT} />;

/** A titled block of rows; with `onMore`, the header carries the arrow to the group's page. */
const Group = ({
  children,
  onMore,
  title,
}: {
  children: ReactNode;
  onMore?: () => void;
  title: string;
}) => {
  const { t } = useTranslation('setting');
  return (
    <Flexbox gap={8}>
      <div {...stylex.props(styles.divider)} />
      <div {...stylex.props(styles.header, onMore && styles.headerLink)} onClick={onMore}>
        <Text weight={600}>{title}</Text>
        {onMore && (
          <ActionIcon icon={ChevronRight} size={'small'} title={t('market.apps.viewAll')} />
        )}
      </div>
      {children}
    </Flexbox>
  );
};

const useCategoryName = () => {
  const { t } = useTranslation('discover');
  return (category: string) =>
    t(`skills.categories.${category}.name`, { defaultValue: category }) as string;
};

/** Categories already scrolled to while the app is open. */
const seenCategories = new Set<string>();

/**
 * One market category's preview. It asks for its rows only once scrolled near,
 * so the page does not fire a request per category up front.
 */
const CategoryGroup = memo<{ category: string; count: number }>(({ category, count }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [inViewport] = useInViewport(ref, { rootMargin: '200px' });
  // Remembered across visits, so coming back paints the cached rows instead of a skeleton.
  const [seen, setSeen] = useState(() => seenCategories.has(category));
  if (inViewport && !seen) {
    seenCategories.add(category);
    setSeen(true);
  }
  const { isLoading, items } = useMarketSkills({ category }, PREVIEW_COUNT, seen);
  const { setGroup: setSkillGroup } = useSkillsNav();
  const categoryName = useCategoryName();

  return (
    <div ref={ref}>
      <Group
        title={categoryName(category)}
        onMore={count > PREVIEW_COUNT ? () => setSkillGroup(category) : undefined}
      >
        {!seen || (isLoading && items.length === 0) ? (
          <GridSkeleton />
        ) : (
          <SkillGrid skills={items.slice(0, PREVIEW_COUNT)} />
        )}
      </Group>
    </div>
  );
});

CategoryGroup.displayName = 'MarketSkillCategoryGroup';

/** The grouped catalog: my skills, then each market category, all previews. */
const Catalog = memo(() => {
  const { t } = useTranslation('setting');
  const installed = useInstalledSkills();
  const fromGithub = useInstalledGithubSkills();
  const { setGroup: setSkillGroup } = useSkillsNav();
  const useSkillCategories = useDiscoverStore((s) => s.useSkillCategories);
  const { isLoading, queryKey } = useSkillCategories();
  const categories = useDiscoverStore(skillSelectors.skillCategories(queryKey));
  const groups = useMemo(
    () =>
      (categories ?? [])
        .filter((item) => item.category !== SkillCategory.All && item.count > 0)
        .toSorted((a, b) => b.count - a.count),
    [categories],
  );

  return (
    <>
      {installed.length > 0 && (
        <Group
          title={t('market.skills.installedGroup')}
          onMore={
            installed.length > PREVIEW_COUNT ? () => setSkillGroup(INSTALLED_GROUP) : undefined
          }
        >
          <SkillGrid withAgents skills={installed.slice(0, PREVIEW_COUNT)} />
        </Group>
      )}
      {fromGithub.length > 0 && (
        <Group title={t('market.skills.github.installedGroup')}>
          <InstalledGithubSkills items={fromGithub} />
        </Group>
      )}
      {isLoading && !categories ? (
        <>
          <SectionSkeleton count={PREVIEW_COUNT} />
          <SectionSkeleton count={PREVIEW_COUNT} />
        </>
      ) : (
        groups.map(({ category, count }) => (
          <CategoryGroup category={category} count={count} key={category} />
        ))
      )}
    </>
  );
});

Catalog.displayName = 'MarketSkillCatalog';

/** Search results: matching installed skills first, then the market's. */
const SearchResults = memo<{ query: string }>(({ query }) => {
  const { t } = useTranslation('setting');
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const installed = useInstalledSkills().filter((skill) => matches(skill, query));
  const fromGithub = useInstalledGithubSkills(query);
  const address = parseGithubSource(query);
  const { setGithubUrl } = useSkillsNav();
  const { isLoading, items, total } = useMarketSkills({ q: query }, pageSize, !address);

  // A pasted GitHub address is a repository to add, not words to search for.
  if (address)
    return (
      <Group title={t('market.skills.github.group')}>
        <GithubAddressRow
          repo={[address.owner, address.repo, address.path].filter(Boolean).join('/')}
          onOpen={() => setGithubUrl(address.url)}
        />
      </Group>
    );

  return (
    <>
      {installed.length > 0 && (
        <Group title={t('market.skills.installedGroup')}>
          <SkillGrid withAgents skills={installed} />
        </Group>
      )}
      {fromGithub.length > 0 && (
        <Group title={t('market.skills.github.installedGroup')}>
          <InstalledGithubSkills items={fromGithub} />
        </Group>
      )}
      <Group title={t('market.skills.results')}>
        {isLoading && items.length === 0 ? (
          <GridSkeleton />
        ) : items.length === 0 ? (
          <Center paddingBlock={48}>
            <Text type={'secondary'}>{t('market.skills.empty')}</Text>
          </Center>
        ) : (
          <SkillGrid skills={items} />
        )}
        {items.length > 0 && items.length < total && (
          <Center paddingBlock={8}>
            <Button
              loading={isLoading}
              type={'fill'}
              onClick={() => setPageSize((size) => size + PAGE_SIZE)}
            >
              {t('market.skills.more')}
            </Button>
          </Center>
        )}
      </Group>
      <Group title={t('market.skills.github.group')}>
        <GithubSearchResults query={query} />
      </Group>
    </>
  );
});

SearchResults.displayName = 'MarketSkillSearchResults';

/** A group's own page: every installed skill, or a whole market category with paging. */
const GroupPage = memo<{ group: string }>(({ group }) => {
  const { t } = useTranslation('setting');
  const { setGroup: setSkillGroup } = useSkillsNav();
  const categoryName = useCategoryName();
  const installedGroup = group === INSTALLED_GROUP;
  const installed = useInstalledSkills();
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const market = useMarketSkills({ category: group }, pageSize, !installedGroup);

  const skills = installedGroup ? installed : market.items;

  return (
    <Flexbox gap={20}>
      <Flexbox gap={12}>
        <BackLink onClick={() => setSkillGroup(null)} />
        <Text fontSize={20} weight={600}>
          {installedGroup ? t('market.skills.installedGroup') : categoryName(group)}
        </Text>
      </Flexbox>
      {!installedGroup && market.isLoading && skills.length === 0 ? (
        <GridSkeleton />
      ) : (
        <SkillGrid skills={skills} withAgents={installedGroup} />
      )}
      {!installedGroup && skills.length > 0 && skills.length < market.total && (
        <Center paddingBlock={8}>
          <Button
            loading={market.isLoading}
            type={'fill'}
            onClick={() => setPageSize((size) => size + PAGE_SIZE)}
          >
            {t('market.skills.more')}
          </Button>
        </Center>
      )}
    </Flexbox>
  );
});

GroupPage.displayName = 'MarketSkillGroupPage';

/**
 * The Skills page: my skills (from the Market, then from GitHub), then the LobeHub
 * Market's skills by category, each a short preview whose arrow opens the whole
 * group. Searching lists every match, then public GitHub repositories; a pasted
 * GitHub address offers that repository instead. "Add from GitHub" opens the
 * GitHub import page with an empty address.
 */
const SkillsPage = memo(() => {
  const { t } = useTranslation('setting');
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), { wait: 300 });
  const { githubUrl, group: skillGroup, setGithubUrl } = useSkillsNav();

  if (githubUrl !== null)
    return (
      <GithubImportPage initialUrl={githubUrl} key={githubUrl} onBack={() => setGithubUrl(null)} />
    );
  if (skillGroup) return <GroupPage group={skillGroup} />;

  return (
    <Flexbox gap={20}>
      <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
        <Flexbox gap={4}>
          <Text fontSize={20} weight={600}>
            {t('market.skills.title')}
          </Text>
          <Text type={'secondary'}>{t('market.skills.desc')}</Text>
        </Flexbox>
        <Button icon={GithubIcon} type={'fill'} onClick={() => setGithubUrl('')}>
          {t('market.skills.github.entry')}
        </Button>
      </Flexbox>
      <SearchBar
        allowClear
        placeholder={t('market.skills.search')}
        value={query}
        variant={'filled'}
        onChange={(event) => setQuery(event.target.value)}
      />
      {q ? <SearchResults query={q} /> : <Catalog />}
    </Flexbox>
  );
});

SkillsPage.displayName = 'MarketSkillsPage';

export default SkillsPage;
