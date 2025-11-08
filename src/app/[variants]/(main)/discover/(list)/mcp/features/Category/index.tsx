'use client';

import { Icon, Tag } from '@lobehub/ui';
import qs from 'query-string';
import { memo, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/discover/features/const';
import { withSuspense } from '@/components/withSuspense';
import { useCategory } from '@/hooks/useMCPCategory';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { McpCategory } from '@/types/discover';

import CategoryMenu from '../../../../components/CategoryMenu';

const Category = memo(() => {
  const useMcpCategories = useDiscoverStore((s) => s.useMcpCategories);
  const { category = 'all', q } = useQuery() as { category?: McpCategory; q?: string };
  const { data: items = [] } = useMcpCategories({ q });
  const navigate = useNavigate();
  const cates = useCategory();

  const genUrl = (key: McpCategory) =>
    qs.stringifyUrl(
      {
        query: { category: key === McpCategory.All ? null : key, q },
        url: '/mcp',
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
      mode={'inline'}
      onClick={(v) => handleClick(v.key as McpCategory)}
      selectedKeys={[category]}
    />
  );
});

export default withSuspense(Category);
