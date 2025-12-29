'use client';

import { type BuiltinInspectorProps, type SearchQuery } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextDescription};
  `,
}));

export const SearchInspector = memo<BuiltinInspectorProps<SearchQuery>>(({ args, isLoading }) => {
  const { t } = useTranslation('plugin');

  const query = args?.query || '';

  // When loading, show "联网搜索 > 搜索页面"
  if (isLoading) {
    return (
      <div className={cx(styles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-web-browsing.title')}</span>
        <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
        <span>{t('builtins.lobe-web-browsing.apiName.search')}</span>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <span>{t('builtins.lobe-web-browsing.apiName.search')}</span>
      {query && (
        <>
          <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
          <span>{query}</span>
        </>
      )}
    </div>
  );
});

SearchInspector.displayName = 'SearchInspector';

export default SearchInspector;
