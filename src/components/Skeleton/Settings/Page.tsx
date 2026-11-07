'use client';

import { useLocation } from 'react-router';

import SettingContainer from '@/features/Setting/SettingContainer';
import { OWN_FRAME_TABS } from '@/features/Settings/features/ownFrameTabs';
import SettingsPageActions from '@/features/Settings/features/SettingsPageActions';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';
import { isMobileSurface } from '@/utils/mobileSurface';

import { SettingsSkeletonFrame } from './Frame';
import SettingsSectionSkeleton from './Section';
import { getSettingsTabSkeleton, type SettingsTabSkeleton } from './tabs';

const GENERIC: SettingsTabSkeleton = { Body: () => <SettingsSectionSkeleton /> };

/** The tab and sub-segment a settings pathname renders; `/settings` opens the profile. */
export const resolveSettingsSkeletonTab = (pathname: string): { sub?: string; tab: string } => {
  const [, tab = 'profile', sub] = pathname.match(/\/settings\/([^/]+)(?:\/([^/]+))?/) ?? [];
  return { sub, tab };
};

const useTabSkeleton = () => {
  const { sub, tab } = resolveSettingsSkeletonTab(useLocation().pathname);
  return { skeleton: getSettingsTabSkeleton(tab) ?? GENERIC, sub, tab };
};

/** The active tab's body alone, for hosts that already draw the header and container. */
export const SettingsBodySkeleton = () => {
  const { skeleton, sub } = useTabSkeleton();
  return <skeleton.Body sub={sub} />;
};

/**
 * Chunk fallback of a settings tab component. `SettingsContent` draws the frame
 * around in-frame tabs before their chunk loads, so they get the body plus their
 * page-action placeholders in the real page-actions row; own-frame tabs get their whole
 * page, except under the mobile layout.
 */
export const SettingsChunkSkeleton = () => {
  const { skeleton, sub, tab } = useTabSkeleton();
  if (OWN_FRAME_TABS.has(tab) && skeleton.Page && !isMobileSurface())
    return <skeleton.Page sub={sub} />;

  return (
    <>
      {skeleton.PageActions && (
        <SettingsPageActions>
          <skeleton.PageActions sub={sub} />
        </SettingsPageActions>
      )}
      <skeleton.Body sub={sub} />
    </>
  );
};

/**
 * Route fallback of a settings tab: the shared header with the real tab title,
 * the padded container and the tab body. Under `chrome='body'` the host layout
 * already draws the header, so only the container and body render.
 */
const SettingsPageSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => {
  const { skeleton, sub, tab } = useTabSkeleton();
  const body = <skeleton.Body sub={sub} />;

  if (chrome === 'body')
    return (
      <SettingContainer maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
        {body}
      </SettingContainer>
    );

  if (OWN_FRAME_TABS.has(tab) && skeleton.Page) return <skeleton.Page sub={sub} />;

  return (
    <SettingsSkeletonFrame
      actions={skeleton.PageActions && <skeleton.PageActions sub={sub} />}
      tab={tab}
    >
      {body}
    </SettingsSkeletonFrame>
  );
};

export default SettingsPageSkeleton;
