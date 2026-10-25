'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { type ComponentType, type FC, type PropsWithChildren, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useMatches } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import NavHeader from '@/features/NavHeader';
import { findRouteTitleKey } from '@/features/NavHeader/routeTitle';

export interface MobileShellHandle {
  /**
   * The page renders no `NavHeader` of its own (desktop gives it the sidebar
   * and titlebar instead), so the mobile shell adds one: back button, sidebar
   * drawer and the route title — or no title (`'untitled'`) when the page
   * opens with its own heading.
   */
  mobileShellHeader?: boolean | 'untitled';
  /** Replaces the static route title when the header should name the record. */
  mobileShellTitle?: ComponentType;
}

const getShellHandle = (handle: unknown): MobileShellHandle =>
  handle && typeof handle === 'object' ? (handle as MobileShellHandle) : {};

interface ShellHeader {
  Title?: ComponentType;
  titleKey: string | null;
}

const useShellHeader = (): ShellHeader | undefined => {
  const matches = useMatches();

  return useMemo(() => {
    const { mobileShellHeader, mobileShellTitle } = getShellHandle(matches.at(-1)?.handle);
    if (!mobileShellHeader) return undefined;
    if (mobileShellHeader === 'untitled') return { titleKey: null };

    return {
      Title: mobileShellTitle,
      titleKey: findRouteTitleKey(matches.map((match) => match.handle)) ?? null,
    };
  }, [matches]);
};

/**
 * Full-screen host for a desktop page mounted on mobile. Pages normally render
 * their own `NavHeader`, which on mobile carries the back button and the
 * sidebar drawer; routes flagged `mobileShellHeader` get one from here.
 */
const MobilePageLayout: FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation('electron');
  const header = useShellHeader();

  const content = children ?? <Outlet />;
  const staticTitle = header?.titleKey ? (
    <Text ellipsis weight={500}>
      {t(header.titleKey as any)}
    </Text>
  ) : null;

  return (
    <MobileContentLayout style={{ overflowY: 'hidden' }}>
      {header === undefined ? (
        content
      ) : (
        <Flexbox height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
          <NavHeader
            left={
              header.Title ? (
                <Suspense fallback={staticTitle}>
                  <header.Title />
                </Suspense>
              ) : (
                staticTitle
              )
            }
          />
          <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
            {content}
          </Flexbox>
        </Flexbox>
      )}
    </MobileContentLayout>
  );
};

export default MobilePageLayout;
