import type { BuiltinRenderProps, CrawlPluginState, CrawlSinglePageQuery } from '@lobechat/types';
import { memo } from 'react';

import PageContent from './PageContent';

const CrawlSinglePage = memo<BuiltinRenderProps<CrawlSinglePageQuery, CrawlPluginState>>(
  ({ messageId, pluginState, args }) => {
    const { results } = pluginState || {};
    const { url } = args || {};

    return <PageContent messageId={messageId} results={results} urls={[url]} />;
  },
);

export default CrawlSinglePage;
