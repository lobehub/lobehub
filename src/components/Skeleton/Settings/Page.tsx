'use client';

import { Flexbox } from '@lobehub/ui';
import { useLocation } from 'react-router';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from '../Bar';
import { MessengerPlatformDetailSkeleton } from './MessengerDetail';
import SettingsProfileSkeleton from './Profile';
import SettingsSectionSkeleton from './Section';

type SettingsSkeletonBody =
  { kind: 'messengerDetail'; platform: string } | { kind: 'profile' } | { kind: 'section' };

export const resolveSettingsSkeletonBody = (pathname: string): SettingsSkeletonBody => {
  const [, tab = 'profile', sub] = pathname.match(/\/settings\/([^/]+)(?:\/([^/]+))?/) ?? [];

  if (tab === 'profile') return { kind: 'profile' };
  if (tab === 'messenger' && sub) return { kind: 'messengerDetail', platform: sub };
  return { kind: 'section' };
};

export const SettingsBodySkeleton = () => {
  const body = resolveSettingsSkeletonBody(useLocation().pathname);

  if (body.kind === 'profile') return <SettingsProfileSkeleton />;
  if (body.kind === 'messengerDetail')
    return <MessengerPlatformDetailSkeleton platform={body.platform} />;
  return <SettingsSectionSkeleton />;
};

const SettingsPageSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => {
  const profile = resolveSettingsSkeletonBody(useLocation().pathname).kind === 'profile';

  return (
    <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      {chrome !== 'body' && (
        <NavHeader styles={{ center: { alignItems: 'center' } }}>
          <SkeletonBar height={16} width={profile ? 52 : 88} />
        </NavHeader>
      )}
      <SettingContainer maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
        <SettingsBodySkeleton />
      </SettingContainer>
    </Flexbox>
  );
};

export default SettingsPageSkeleton;
