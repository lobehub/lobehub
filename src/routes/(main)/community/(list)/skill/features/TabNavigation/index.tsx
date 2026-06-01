'use client';

import { Tabs } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuery } from '@/hooks/useQuery';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { type SkillQueryParams, SkillSorts } from '@/types/discover';

import { SKILL_TABS, SkillTabKey } from './const';

const styles = createStaticStyles(({ css, cssVar }) => ({
  tabs: css`
    .ant-tabs-nav {
      margin-block-end: 0;

      &::before {
        border-block-end: none;
      }
    }

    .ant-tabs-tab {
      padding-block: 8px;
      padding-inline: 16px;
      border-radius: 8px;

      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    }

    .ant-tabs-tab-active {
      border: 1px solid ${cssVar.colorBorder};
      background: ${cssVar.colorFillSecondary};

      .ant-tabs-tab-btn {
        color: ${cssVar.colorText};
      }
    }

    .ant-tabs-ink-bar {
      display: none;
    }
  `,
}));

const TabNavigation = memo(() => {
  const { t } = useTranslation('discover');
  const router = useQueryRoute();
  const { category, sort } = useQuery() as SkillQueryParams;

  const activeTab = useMemo(() => {
    if (!category && !sort) return SkillTabKey.Discover;
    if (sort === SkillSorts.InstallCount && !category) return SkillTabKey.Trending;
    if (sort === SkillSorts.CreatedAt && !category) return SkillTabKey.New;

    const categoryTab = SKILL_TABS.find((tab) => tab.category === category);
    return categoryTab?.key ?? SkillTabKey.Discover;
  }, [category, sort]);

  const handleTabChange = (key: string) => {
    const tab = SKILL_TABS.find((item) => item.key === key);
    if (!tab) return;

    if (tab.key === SkillTabKey.Discover) {
      router.push('/community/skill', { query: {}, replace: true });
    } else if (tab.isCategory && tab.category) {
      router.push('/community/skill', { query: { category: tab.category }, replace: true });
    } else if (tab.sort) {
      router.push('/community/skill', { query: { sort: tab.sort }, replace: true });
    }
  };

  const items = useMemo(
    () =>
      SKILL_TABS.map((tab) => ({
        key: tab.key,
        label: t(tab.labelKey as any),
      })),
    [t],
  );

  return (
    <Tabs activeKey={activeTab} className={styles.tabs} items={items} onChange={handleTabChange} />
  );
});

export default TabNavigation;
