'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { Link } from 'react-router';

import { ProductLogo } from '@/components/Branding';
import Loading from '@/components/Loading/BrandTextLoading';
import ShareErrorView from '@/features/Share/ErrorView';

export interface ShareShellShareInfo {
  avatar?: ReactNode;
  editUrl?: string;
  isOwner?: boolean;
  openUrl?: string;
}

export interface ShareShellProps {
  aside?: ReactNode;
  children?: ReactNode;
  error?: unknown;
  loading?: boolean;
  share?: ShareShellShareInfo;
  title?: string | null;
}

export interface ShareHeroProps {
  avatar?: ReactNode;
  byline?: ReactNode;
  title?: string | null;
}

export const ShareHero = ({ avatar, byline, title }: ShareHeroProps) => (
  <Flexbox gap={8} paddingBlock={'24px 16px'} paddingInline={24}>
    {avatar}
    {title && (
      <Text as={'h1'} fontSize={24} style={{ margin: 0 }} weight={700}>
        {title}
      </Text>
    )}
    {byline && (
      <Text fontSize={12} type={'secondary'}>
        {byline}
      </Text>
    )}
  </Flexbox>
);

export default function ShareShell({ aside, children, error, loading }: ShareShellProps) {
  let body = children;
  if (error) body = <ShareErrorView error={error} />;
  else if (loading) body = <Loading debugId="share shell" />;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <Flexbox horizontal align={'center'} padding={12}>
        <Link style={{ color: 'inherit' }} to="/">
          <ProductLogo size={32} />
        </Link>
      </Flexbox>
      <Flexbox horizontal flex={1} style={{ overflow: 'hidden' }}>
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          {body}
        </Flexbox>
        {aside}
      </Flexbox>
    </Flexbox>
  );
}
