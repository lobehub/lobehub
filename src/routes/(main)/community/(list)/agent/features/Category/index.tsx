'use client';

import { Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import qs from 'query-string';
import { memo, useMemo } from 'react';

import { withSuspense } from '@/components/withSuspense';
import { buildAssistantListQuery } from '@/features/CommunityAgentList/assistantListQuery';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useQuery } from '@/hooks/useQuery';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { useDiscoverStore } from '@/store/discover';
import { AssistantCategory, type AssistantQueryParams, AssistantSorts } from '@/types/discover';

import CategoryMenu from '../../../../components/CategoryMenu';
import { useCategory } from './useCategory';

const Category = memo(() => {
  const useAssistantCategories = useDiscoverStore((s) => s.useAssistantCategories);
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const query = useQuery() as AssistantQueryParams;
  const { category = AssistantCategory.Discover, q, source } = query;
  const { data } = useAssistantList(buildAssistantListQuery(query), { keepPreviousData: true });
  const shouldLoadFallbackCategories = data !== undefined && data.categoryCounts === undefined;
  const { data: fallbackItems = [] } = useAssistantCategories(
    { q, source },
    { enabled: shouldLoadFallbackCategories },
  );
  const items = data?.categoryCounts ?? fallbackItems;
  const navigate = useWorkspaceAwareNavigate();
  const cates = useCategory();

  const genUrl = (key: AssistantCategory) =>
    qs.stringifyUrl(
      {
        query: {
          category: key === AssistantCategory.Discover ? null : key,
          q,
          sort: key === AssistantCategory.Discover ? AssistantSorts.Recommended : null,
        },
        url: '/community/agent',
      },
      { skipNull: true },
    );

  const handleClick = (key: AssistantCategory) => {
    navigate(genUrl(key));
    const scrollableElement = document?.querySelector(`#${SCROLL_PARENT_ID}`);
    if (!scrollableElement) return;
    scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
  };

  const total = useMemo(() => items.reduce((acc, item) => acc + item.count, 0), [items]);

  return (
    <CategoryMenu
      mode={'inline'}
      selectedKeys={[category]}
      items={cates.map((item) => {
        const itemData = items.find((i) => i.category === item.key);
        return {
          extra:
            item.key === 'all'
              ? total > 0 && (
                  <Tag
                    size={'small'}
                    style={{
                      borderRadius: 12,
                      paddingInline: 6,
                    }}
                  >
                    {total}
                  </Tag>
                )
              : itemData && (
                  <Tag
                    size={'small'}
                    style={{
                      borderRadius: 12,
                      paddingInline: 6,
                    }}
                  >
                    {itemData.count}
                  </Tag>
                ),
          ...item,
          icon: <Icon icon={item.icon} size={18} />,
          label: <WorkspaceLink to={genUrl(item.key)}>{item.label}</WorkspaceLink>,
        };
      })}
      onClick={(v) => handleClick(v.key as AssistantCategory)}
    />
  );
});

export default withSuspense(Category);
