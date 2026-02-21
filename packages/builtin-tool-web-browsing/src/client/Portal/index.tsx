import type { BuiltinPortalProps, CrawlPluginState, SearchQuery } from '@lobechat/types';
import { memo } from 'react';

import { WebBrowsingApiName } from '../../types';
import PageContent from './PageContent';
import PageContents from './PageContents';
import Search from './Search';

const Inspector = memo<BuiltinPortalProps>(({ arguments: args, messageId, state, apiName }) => {
  switch (apiName) {
    // 兼容旧版数据
    case WebBrowsingApiName.search: {
      return <Search messageId={messageId} query={args as SearchQuery} response={state} />;
    }

    case WebBrowsingApiName.crawlSinglePage: {
      const url = args.url;
      const result = (state as CrawlPluginState).results.find(
        (result) => result.originalUrl === url,
      );

      return <PageContent messageId={messageId} result={result} />;
    }

    case WebBrowsingApiName.crawlMultiPages: {
      return (
        <PageContents
          messageId={messageId}
          results={(state as CrawlPluginState).results}
          urls={args.urls}
        />
      );
    }
  }

  return null;
});

export default Inspector;
