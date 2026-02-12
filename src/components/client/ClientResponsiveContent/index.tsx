'use client';

import { type Loader } from 'next/dist/shared/lib/dynamic';
import { type FC } from 'react';
import { memo } from 'react';

import MobileSwitchLoading from '@/features/MobileSwitchLoading';
import { useIsMobile } from '@/hooks/useIsMobile';
import dynamic from '@/libs/next/dynamic';

interface ClientResponsiveContentProps {
  Desktop: FC;
  Mobile: Loader;
}

const ClientResponsiveContent = ({ Mobile, Desktop }: ClientResponsiveContentProps) => {
  const MobileComponent = dynamic(Mobile, {
    loading: MobileSwitchLoading,
    ssr: false,
  });

  const Content = memo(() => {
    const mobile = useIsMobile();

    return mobile ? <MobileComponent /> : <Desktop />;
  });

  Content.displayName = 'ClientResponsiveContent';

  return Content;
};

export default ClientResponsiveContent;
