'use client';

import { Icon, Tag } from '@lobehub/ui';
import qs from 'query-string';
import { memo, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { withSuspense } from '@/components/withSuspense';
import { useQuery } from '@/hooks/useQuery';
import { useSkillCategory } from '@/hooks/useSkillCategory';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { useDiscoverStore } from '@/store/discover';
import { SkillCategory, SkillSorts } from '@/types/discover';

import CategoryMenu from '../../../../components/CategoryMenu';

const Category = memo(() => {
  const useSkillCategories = useDiscoverStore((s) => s.useSkillCategories);
  const { category = SkillCategory.All, q } = useQuery() as {
    category?: SkillCategory;
    q?: string;
  };
  const { data: items = [] } = useSkillCategories({ q });
  const navigate = useNavigate();
  const cates = useSkillCategory();

  const genUrl = (key: SkillCategory) =>
    qs.stringifyUrl(
      {
        query: {
          category: key === SkillCategory.All ? null : key,
          q,
          sort: key === SkillCategory.All ? SkillSorts.InstallCount : null,
        },
        url: '/community/skill',
      },
      { skipNull: true },
    );

  const handleClick = (key: SkillCategory) => {
    navigate(genUrl(key));
    const scrollableElement = document?.querySelector(`#${SCROLL_PARENT_ID}`);
    if (!scrollableElement) return;
    scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
  };
  const total = useMemo(() => items.reduce((acc, item) => acc + (item.count || 0), 0), [items]);

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
      onClick={(v) => handleClick(v.key as SkillCategory)}
    />
  );
});

export default withSuspense(Category);
