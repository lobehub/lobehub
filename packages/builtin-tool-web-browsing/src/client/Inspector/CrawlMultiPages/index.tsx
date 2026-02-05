'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

interface CrawlMultiPagesParams {
  urls: string[];
}

export const CrawlMultiPagesInspector = memo<BuiltinInspectorProps<CrawlMultiPagesParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const urls = args?.urls || partialArgs?.urls;

    // Show count and first domain for context
    let displayText = '';
    if (urls && urls.length > 0) {
      const count = urls.length;
      try {
        const firstUrl = new URL(urls[0]);
        displayText = count > 1 ? `${firstUrl.hostname} +${count - 1}` : firstUrl.hostname;
      } catch {
        displayText = `${count} pages`;
      }
    }

    if (isArgumentsStreaming && !displayText) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-web-browsing.apiName.crawlMultiPages')}</span>
        </div>
      );
    }

    return (
      <div
        className={cx(inspectorTextStyles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
      >
        <span>{t('builtins.lobe-web-browsing.apiName.crawlMultiPages')}: </span>
        {displayText && <span className={highlightTextStyles.gold}>{displayText}</span>}
      </div>
    );
  },
);

CrawlMultiPagesInspector.displayName = 'CrawlMultiPagesInspector';

export default CrawlMultiPagesInspector;
