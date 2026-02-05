'use client';

import { Icon, Tag } from '@lobehub/ui';
import qs from 'query-string';
import { memo, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/community/features/const';
import { withSuspense } from '@/components/withSuspense';
import { useCategory } from '@/hooks/useMCPCategory';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { McpCategory, McpSorts } from '@/types/discover';

import CategoryMenu from '../../../../components/CategoryMenu';

const Category = memo(() => {
  const useMcpCategories = useDiscoverStore((s) => s.useMcpCategories);
  const { category = McpCategory.Discover, q } = useQuery() as {
    category?: McpCategory;
    q?: string;
  };
  const { data: items = [] } = useMcpCategories({ q });
  const navigate = useNavigate();
  const cates = useCategory();

  const genUrl = (key: McpCategory) =>
    qs.stringifyUrl(
      {
        query: {
          category: key === McpCategory.Discover ? null : key,
          q,
          sort: key === McpCategory.Discover ? McpSorts.Recommended : null,
        },
        url: '/community/mcp',
      },
      { skipNull: true },
    );

  const handleClick = (key: McpCategory) => {
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
          label: <Link to={genUrl(item.key)}>{item.label}</Link>,
        };
      })}
      onClick={(v) => handleClick(v.key as McpCategory)}
    />
  );
});

export default withSuspense(Category);
