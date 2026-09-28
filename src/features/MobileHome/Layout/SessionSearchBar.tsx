'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { SearchBar } from '@lobehub/ui';
import { type ChangeEvent } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const SessionSearchBar = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('chat');
  const isLoaded = useUserStore((s) => s.isLoaded);
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.Search));

  const [keywords, updateSearchKeywords] = useSessionStore((s) => [
    s.sessionSearchKeywords,
    s.updateSearchKeywords,
  ]);
  const useSearchAgents = useHomeStore((s) => s.useSearchAgents);

  const { isValidating } = useSearchAgents(keywords?.trim() || undefined);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      updateSearchKeywords(e.target.value);
    },
    [updateSearchKeywords],
  );

  return (
    <SearchBar
      allowClear
      enableShortKey={!mobile}
      loading={!isLoaded || isValidating}
      placeholder={t('searchAgentPlaceholder')}
      shortKey={hotkey}
      spotlight={!mobile}
      value={keywords}
      variant={'filled'}
      onChange={handleChange}
    />
  );
});

export default SessionSearchBar;
