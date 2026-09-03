'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

interface CrawlSinglePageParams {
  url: string;
}

export const CrawlSinglePageInspector = memo<BuiltinInspectorProps<CrawlSinglePageParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const url = args?.url || partialArgs?.url;

    if (isArgumentsStreaming && !url) {
      return (
        <div className={inspectorTextStyles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-web-browsing.apiName.crawlSinglePage')}
          </span>
        </div>
      );
    }

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx(isArgumentsStreaming && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-web-browsing.apiName.crawlSinglePage')}:{'\u00A0'}
        </span>
        {url && <span className={highlightTextStyles.gold}>{url}</span>}
      </div>
    );
  },
);

CrawlSinglePageInspector.displayName = 'CrawlSinglePageInspector';

export default CrawlSinglePageInspector;
