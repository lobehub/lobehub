import type { CrawlResult } from '@lobechat/types';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';

import PageContent from '../PageContent';

interface PageContentProps {
  messageId: string;
  results: CrawlResult[];
  urls: string[];
}

const PageContents = memo<PageContentProps>(({ urls, messageId, results }) => {
  const activePageContentUrl = useChatStore((s) => s.activePageContentUrl);

  const url = urls.find((u) => u === activePageContentUrl);
  const result = results.find((result) => result.originalUrl === url);

  return <PageContent messageId={messageId} result={result} />;
});

export default PageContents;
