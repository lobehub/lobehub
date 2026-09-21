'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { SearchBar } from '@lobehub/ui';
import { type ChangeEvent, type KeyboardEvent } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

/**
 * Sidebar search for the current library. The value lives in the resource
 * manager store so the hierarchy below can swap to results, and so switching
 * libraries can reset it. `SearchBar` owns the focus hotkey (⌘J by default,
 * user-configurable under Settings → Hotkeys) and only binds it while this
 * sidebar is mounted.
 */
const LibrarySearchBar = memo(() => {
  const { t } = useTranslation('file');
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.Search));
  const [query, setQuery] = useResourceManagerStore((s) => [
    s.librarySearchQuery,
    s.setLibrarySearchQuery,
  ]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
    [setQuery],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Escape') return;
      // Escape clears and leaves the field so the tree comes straight back.
      setQuery('');
      e.currentTarget.blur();
    },
    [setQuery],
  );

  return (
    <SearchBar
      allowClear
      enableShortKey
      placeholder={t('library.hierarchy.search.placeholder')}
      shortKey={hotkey}
      style={{ flex: 1, minWidth: 0 }}
      value={query}
      variant={'filled'}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  );
});

LibrarySearchBar.displayName = 'LibrarySearchBar';

export default LibrarySearchBar;
