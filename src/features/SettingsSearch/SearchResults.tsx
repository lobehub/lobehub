'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useSettingsSearchAnalytics } from './analytics';
import { useSettingsSearch } from './useSettingsSearch';

const styles = createStaticStyles(({ css }) => ({
  match: css`
    color: ${cssVar.colorPrimary};
  `,
}));

const HighlightMatch = memo<{ query: string; text: string }>(({ text, query }) => {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <span className={styles.match}>{text.slice(index, index + query.length)}</span>
      {text.slice(index + query.length)}
    </>
  );
});

HighlightMatch.displayName = 'HighlightMatch';

const SearchResults = memo<{ query: string }>(({ query }) => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const results = useSettingsSearch(query);
  const { trackResultClick } = useSettingsSearchAnalytics(query, results);
  const keyword = query.trim();

  if (results.length === 0)
    return (
      <Flexbox align={'center'} paddingBlock={24} paddingInline={8}>
        <Text fontSize={12} type={'secondary'}>
          {t('settingsSearch.empty', { keyword })}
        </Text>
      </Flexbox>
    );

  return (
    <Flexbox gap={1} paddingBlock={4}>
      {results.map((result, index) => (
        <NavItem
          href={result.url}
          icon={result.icon}
          key={result.key}
          title={<HighlightMatch query={keyword} text={result.label} />}
          description={
            <Text ellipsis fontSize={12} type={'secondary'}>
              {result.breadcrumb}
            </Text>
          }
          onClick={() => {
            trackResultClick(result, index + 1);
            navigate(result.url);
          }}
        />
      ))}
    </Flexbox>
  );
});

SearchResults.displayName = 'SearchResults';

export default SearchResults;
