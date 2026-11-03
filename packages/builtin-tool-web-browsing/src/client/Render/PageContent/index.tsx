import type { CrawlPluginState } from '@lobechat/types';
import type { CrawlErrorResult } from '@lobechat/web-crawler';
import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';

import Loading from './Loading';
import Result from './Result';

interface PagesContentProps {
  messageId: string;
  results?: CrawlPluginState['results'];
  urls?: string[];
}

const PagesContent = memo<PagesContentProps>(({ results, messageId, urls = [] }) => {
  if (!results || results.length === 0) {
    return (
      <Flexbox horizontal gap={8}>
        {urls &&
          urls.length > 0 &&
          urls.map((url, index) => <Loading key={`${url}_${index}`} url={url} />)}
      </Flexbox>
    );
  }

  return (
    <ScrollShadow horizontal gap={8} offset={8} orientation={'horizontal'} size={4}>
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
