'use client';

import type { BuiltinPlaceholderProps } from '@lobechat/types';
import { memo } from 'react';

import LoadingCard from '../Render/PageContent/Loading';

const CrawlSinglePage = memo<BuiltinPlaceholderProps<{ url: string }>>(({ args }) => {
  return <LoadingCard url={args?.url || ''} />;
});

export default CrawlSinglePage;
