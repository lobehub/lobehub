import {
  BuiltinRenderProps,
  CrawlMultiPagesQuery,
  CrawlPluginState,
  CrawlSinglePageQuery,
  SearchContent,
  SearchQuery,
  UniformSearchResponse,
} from '@lobechat/types';
import { memo } from 'react';

import { WebBrowsingApiName } from '@/tools/web-browsing';
import PageContent from '@/tools/web-browsing/Render/PageContent';

import Search from './Search';

const WebBrowsing = memo<BuiltinRenderProps<SearchContent[]>>(
  ({ messageId, args, pluginState, pluginError, apiName }) => {
    switch (apiName) {
      case WebBrowsingApiName.search:
      case 'searchWithSearXNG': {
        return (
          <Search
            messageId={messageId}
            pluginError={pluginError}
            searchQuery={(args as SearchQuery) || {}}
            searchResponse={pluginState as UniformSearchResponse}
          />
        );
      }

      case WebBrowsingApiName.crawlSinglePage: {
        return (
          <PageContent
            messageId={messageId}
            results={(pluginState as CrawlPluginState)?.results}
            urls={[(args as CrawlSinglePageQuery)?.url]}
          />
        );
      }

      case WebBrowsingApiName.crawlMultiPages: {
        return (
          <PageContent
            messageId={messageId}
            results={(pluginState as CrawlPluginState)?.results}
            urls={(args as CrawlMultiPagesQuery)?.urls}
          />
        );
      }
    }
  },
);

WebBrowsing.displayName = 'WebBrowsing';

export default WebBrowsing;
