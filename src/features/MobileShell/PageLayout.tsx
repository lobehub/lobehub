'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { type FC, type PropsWithChildren, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useMatches } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import NavHeader from '@/features/NavHeader';
import { getRouteMetaFromHandle } from '@/spa/router/routeMeta';

export interface MobileShellHandle {
  /**
   * The page renders no `NavHeader` of its own (desktop gives it the sidebar
   * and titlebar instead), so the mobile shell adds one: back button, sidebar
   * drawer and the route title — or no title (`'untitled'`) when the page
   * opens with its own heading.
   */
  mobileShellHeader?: boolean | 'untitled';
}

const getShellHeader = (handle: unknown): MobileShellHandle['mobileShellHeader'] =>
  handle && typeof handle === 'object'
    ? (handle as MobileShellHandle).mobileShellHeader
    : undefined;

const useShellHeaderTitle = (): string | null | undefined => {
  const matches = useMatches();

  return useMemo(() => {
    const shellHeader = getShellHeader(matches.at(-1)?.handle);
    if (!shellHeader) return undefined;
    if (shellHeader === 'untitled') return null;

    for (const match of [...matches].reverse()) {
      const titleKey = getRouteMetaFromHandle(match.handle)?.titleKey;
      if (titleKey) return titleKey;
    }
    return null;
  }, [matches]);
};

/**
 * Full-screen host for a desktop page mounted on mobile. Pages normally render
 * their own `NavHeader`, which on mobile carries the back button and the
 * sidebar drawer; routes flagged `mobileShellHeader` get one from here.
 */
const MobilePageLayout: FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation('electron');
  const titleKey = useShellHeaderTitle();

  const content = children ?? <Outlet />;

  return (
    <MobileContentLayout style={{ overflowY: 'hidden' }}>
      {titleKey === undefined ? (
        content
      ) : (
        <Flexbox height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
          <NavHeader left={titleKey ? <Text weight={500}>{t(titleKey as any)}</Text> : undefined} />
          <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
            {content}
          </Flexbox>
        </Flexbox>
      )}
    </MobileContentLayout>
  );
};

export default MobilePageLayout;
