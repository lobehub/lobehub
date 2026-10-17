'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { memo, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';

import SearchResults from './SearchResults';
import { useImeAwareQuery } from './useImeAwareQuery';
import { useSettingsSearch } from './useSettingsSearch';

/**
 * Self-contained settings-search unit: owns the query state, renders the
 * search bar, and swaps `children` (the category list) for live results while
 * a query is present. Living here (not in the route layout) also means the
 * search index — and the lazy pinyin dict — starts warming up as soon as the
 * sidebar mounts, well before the first keystroke.
 */
const SearchSection = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation('setting');
  const { inputProps, query } = useImeAwareQuery();
  const { isIndexing, results } = useSettingsSearch(query);

  const showResults = !!query.trim();

  return (
    <>
      <Flexbox paddingInline={4}>
        <SearchBar
          allowClear
          placeholder={t('settingsSearch.placeholder')}
          variant={'filled'}
          {...inputProps}
        />
      </Flexbox>
      {showResults ? (
        <SearchResults isIndexing={isIndexing} query={query} results={results} />
      ) : (
        children
      )}
    </>
  );
});

SearchSection.displayName = 'SettingsSearchSection';

export default SearchSection;
