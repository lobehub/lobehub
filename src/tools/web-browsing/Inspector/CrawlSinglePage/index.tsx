'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextDescription};
  `,
}));

interface CrawlSinglePageParams {
  url: string;
}

export const CrawlSinglePageInspector = memo<BuiltinInspectorProps<CrawlSinglePageParams>>(
  ({ args, isLoading }) => {
    const { t } = useTranslation('plugin');

    // When loading, show "联网搜索 > 读取页面内容"
    if (isLoading) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-web-browsing.title')}</span>
          <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
          <span>{t('builtins.lobe-web-browsing.apiName.crawlSinglePage')}</span>
        </div>
      );
    }

    return (
      <div className={styles.root}>
        <span>{t('builtins.lobe-web-browsing.apiName.crawlSinglePage')}</span>
        {args.url && (
          <>
            <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
            <span className={styles.content}>{args.url}</span>
          </>
        )}
      </div>
    );
  },
);

CrawlSinglePageInspector.displayName = 'CrawlSinglePageInspector';

export default CrawlSinglePageInspector;
