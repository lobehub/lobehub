'use client';

import { memo } from 'react';

import Cell from '@/components/Cell';

import { useCategory } from './useCategory';

interface CategoryProps {
  onOpenChangelogModal: () => void;
}

const Category = memo<CategoryProps>(({ onOpenChangelogModal }) => {
  const items = useCategory(onOpenChangelogModal);

  return items?.map(({ key, ...item }, index) => <Cell key={key || index} {...item} />);
});

export default Category;
