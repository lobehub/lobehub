import type { BuiltinRenderProps, CrawlMultiPagesQuery, CrawlPluginState } from '@lobechat/types';
import { memo } from 'react';

import PageContent from './PageContent';

const CrawlMultiPages = memo<BuiltinRenderProps<CrawlMultiPagesQuery, CrawlPluginState>>(
  ({ messageId, pluginState = {}, args = {} }) => {
    const { results } = pluginState;
    const { urls } = args;

    return <PageContent messageId={messageId} results={results} urls={urls} />;
  },
);

export default CrawlMultiPages;
