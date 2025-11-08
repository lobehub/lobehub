'use client';

import { Icon, Tag } from '@lobehub/ui';
import qs from 'query-string';
import { memo, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/discover/features/const';
import { withSuspense } from '@/components/withSuspense';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { AssistantCategory } from '@/types/discover';

import CategoryMenu from '../../../../components/CategoryMenu';
import { useCategory } from './useCategory';

const Category = memo(() => {
  const useAssistantCategories = useDiscoverStore((s) => s.useAssistantCategories);
  const { category = 'all', q } = useQuery() as { category?: AssistantCategory; q?: string };
  const { data: items = [] } = useAssistantCategories({ q });
  const navigate = useNavigate();
  const cates = useCategory();

  const genUrl = (key: AssistantCategory) =>
    qs.stringifyUrl(
      {
        query: { category: key === AssistantCategory.All ? null : key, q },
        url: '/assistant',
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
      onClick={(v) => handleClick(v.key as AssistantCategory)}
      selectedKeys={[category]}
    />
  );
});

export default withSuspense(Category);
