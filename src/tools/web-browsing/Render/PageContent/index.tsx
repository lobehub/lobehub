import { CrawlPluginState } from '@lobechat/types';
import { CrawlErrorResult } from '@lobechat/web-crawler';
import { ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useIsMobile } from '@/hooks/useIsMobile';

import Loading from './Loading';
import Result from './Result';

interface PagesContentProps {
  messageId: string;
  results?: CrawlPluginState['results'];
  urls?: string[];
}

const PagesContent = memo<PagesContentProps>(({ results, messageId, urls = [] }) => {
  const isMobile = useIsMobile();

  if (!results || results.length === 0) {
    return (
      <Flexbox gap={isMobile ? 4 : 12} horizontal={!isMobile}>
        {urls &&
          urls.length > 0 &&
          urls.map((url, index) => <Loading key={`${url}_${index}`} url={url} />)}
      </Flexbox>
    );
  }

  return (
    <ScrollShadow
      gap={isMobile ? 4 : 12}
      horizontal={!isMobile}
      orientation={'horizontal'}
      size={8}
    >
      {results.map((result) => (
        <Result
          crawler={result.crawler}
          key={result.originalUrl}
          messageId={messageId}
          originalUrl={result.originalUrl}
          result={
            result.data ||
            // TODO: Remove this in v2 as it's deprecated
            ({
              content: (result as any)?.content,
              errorMessage: (result as any)?.errorMessage,
              errorType: (result as any)?.errorType,
              url: result.originalUrl,
            } as CrawlErrorResult)
          }
        />
      ))}
    </ScrollShadow>
  );
});

export default PagesContent;
