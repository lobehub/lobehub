'use client';

import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { Trans } from 'react-i18next';

import Title from './Title';

const styles = createStaticStyles(({ css, cssVar }) => ({
  highlight: css`
    color: ${cssVar.colorInfo};

    &::before,
    &::after {
      content: '\`';
    }
  `,
}));

const SearchResultCount = memo<{ count: number; keyword: string }>(({ keyword, count }) => {
  return (
    <Title>
      <Trans
        components={{ highlight: <span className={styles.highlight} /> }}
        i18nKey={'search.result'}
        ns={'discover'}
        values={{
          count,
          keyword,
        }}
      />
    </Title>
  );
});

export default SearchResultCount;
