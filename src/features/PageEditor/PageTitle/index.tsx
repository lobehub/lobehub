'use client';

import { memo } from 'react';

import PageTitle from '@/components/PageTitle';
import { selectors, usePageEditorStore } from '@/features/PageEditor/store';

const Title = memo(() => {
  const pageTitle = usePageEditorStore(selectors.title);
  return pageTitle && <PageTitle title={pageTitle} />;
});

export default Title;
