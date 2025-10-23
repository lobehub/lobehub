'use client';

import { SearchBar, SearchBarProps } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { usePathname } from 'next/navigation';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { withSuspense } from '@/components/withSuspense';
import { useQuery } from '@/hooks/useQuery';
import { useQueryRoute } from '@/hooks/useQueryRoute';

export const useStyles = createStyles(({ css, prefixCls, token }) => ({
  active: css`
    box-shadow: ${token.boxShadow};
  `,
  bar: css`
    .${prefixCls}-input-group-wrapper {
      padding: 0;
    }
  `,
}));

interface StoreSearchBarProps extends SearchBarProps {
  mobile?: boolean;
}

const Search = memo<StoreSearchBarProps>(() => {
  const { t } = useTranslation('discover');
  const pathname = usePathname();
  const { q } = useQuery() as { q?: string };
  const router = useQueryRoute();
  const [word, setWord] = useState<string>(q || '');
  const activeTab = pathname.split('/')[2] || 'assistant';
  const handleSearch = (value: string) => {
    router.push(urlJoin('/discover', activeTab), {
      query: value ? { q: value } : {},
      replace: true,
    });
  };

  return (
    <SearchBar
      data-testid="search-bar"
      defaultValue={q}
      enableShortKey
      onInputChange={(v) => {
        setWord(v);
        if (!v) handleSearch('');
      }}
      onSearch={handleSearch}
      placeholder={t('search.placeholder')}
      style={{
        width: 'min(720px,100%)',
      }}
      value={word}
      variant={'outlined'}
    />
  );
});

export default withSuspense(Search);
