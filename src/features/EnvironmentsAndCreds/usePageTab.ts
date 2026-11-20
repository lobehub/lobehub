'use client';

import { useSearchParams } from 'react-router';

import { type PageTab, TAB_PARAM } from './const';

/**
 * The open tab of the Environments & Vault page, kept in the URL so a reload,
 * a shared link or an old credential link opens the same tab. Environments is
 * the default and leaves the URL clean.
 */
export const usePageTab = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: PageTab = searchParams.get(TAB_PARAM) === 'vault' ? 'vault' : 'environments';

  const setTab = (next: PageTab) => {
    if (next === tab) return;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'environments') params.delete(TAB_PARAM);
        else params.set(TAB_PARAM, next);
        return params;
      },
      { replace: true },
    );
  };

  return [tab, setTab] as const;
};
