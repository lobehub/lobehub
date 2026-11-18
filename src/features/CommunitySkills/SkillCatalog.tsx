import { Block, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { CatalogGrid } from '@/features/MarketplaceCatalog/CatalogGrid';
import { CatalogSections } from '@/features/MarketplaceCatalog/CatalogSections';
import { getLocalizedBuiltinSkillDetail } from '@/features/Settings/skill/features/SkillDetail/localization';
import BuiltinItem from '@/features/SkillStore/SkillList/Builtin/Item';
import MarketSkillItem from '@/features/SkillStore/SkillList/Community/MarketSkillItem';
import { isBuiltinSkillAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { useSkillCategorySections } from '@/hooks/useSkillCategory';
import Pagination from '@/routes/(main)/community/(list)/features/Pagination';
import SkillEmpty from '@/routes/(main)/community/features/SkillEmpty';
import { useDiscoverStore } from '@/store/discover';
import { skillSelectors } from '@/store/discover/selectors';
import { useToolStore } from '@/store/tool';
import { DiscoverTab, SkillCategory, type SkillQueryParams, SkillSorts } from '@/types/discover';

const root = '/community/skill';

export const SkillResults = ({
  query,
  preview = false,
}: {
  query: SkillQueryParams;
  preview?: boolean;
}) => {
  const useList = useDiscoverStore((s) => s.useFetchSkillList);
  const { queryKey, isLoading, error, mutate } = useList({
    ...query,
    category: query.category === SkillCategory.All ? undefined : query.category,
    pageSize: preview ? 6 : 24,
    sort: query.sort ?? SkillSorts.InstallCount,
  });
  const data = useDiscoverStore(skillSelectors.skillList(queryKey));
  return (
    <AsyncBoundary
      data={data}
      empty={<SkillEmpty />}
      error={error}
      isEmpty={!data?.items.length}
      isLoading={isLoading}
      loading={preview ? undefined : <RouteLoading />}
      onRetry={mutate}
    >
      {data && (
        <Flexbox gap={20}>
          <CatalogGrid>
            {data.items.map((item) => (
              <MarketSkillItem key={item.identifier} {...item} community />
            ))}
          </CatalogGrid>
          {!preview && data.totalCount > data.pageSize && (
            <Pagination
              currentPage={data.currentPage}
              pageSize={data.pageSize}
              tab={DiscoverTab.Skills}
              total={data.totalCount}
            />
          )}
        </Flexbox>
      )}
    </AsyncBoundary>
  );
};

export const FeaturedSkills = () => {
  const { t } = useTranslation('discover');
  const { t: ts } = useTranslation('setting');
  const skills = useToolStore((s) => s.builtinSkills).filter((s) =>
    isBuiltinSkillAvailableInCurrentEnv(s.identifier),
  );
  if (!skills.length) return null;
  return (
    <Block gap={12} padding={16} variant="filled">
      <Text as="h2" fontSize={18} weight={600}>
        {t('skills.lobehubPicks')}
      </Text>
      <CatalogGrid>
        {skills.map((skill) => (
          <BuiltinItem
            avatar={skill.avatar}
            identifier={skill.identifier}
            key={skill.identifier}
            detailHref={
              root + '?' + new URLSearchParams({ open: 'builtin-skill:' + skill.identifier })
            }
            {...getLocalizedBuiltinSkillDetail(skill, skill.identifier, ts)}
          />
        ))}
      </CatalogGrid>
    </Block>
  );
};

export const CategorySections = () => {
  const { t } = useTranslation('discover');
  const categories = useSkillCategorySections();
  return (
    <CatalogSections
      categories={categories}
      moreLabel={t('skills.moreCategories')}
      path={root}
      renderPreview={(category) => <SkillResults preview query={{ category }} />}
    />
  );
};
