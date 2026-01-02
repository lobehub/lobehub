'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

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
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-web-browsing.apiName.crawlMultiPages')}</span>
        </div>
      );
    }

    return (
      <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-web-browsing.apiName.crawlMultiPages')}: </span>
        {displayText && <span className={highlightTextStyles.gold}>{displayText}</span>}
      </div>
    );
  },
);

CrawlMultiPagesInspector.displayName = 'CrawlMultiPagesInspector';

export default CrawlMultiPagesInspector;
