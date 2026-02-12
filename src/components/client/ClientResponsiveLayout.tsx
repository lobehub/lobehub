'use client';

import { type Loader } from 'next/dist/shared/lib/dynamic';
import { type FC, type PropsWithChildren } from 'react';
import { memo } from 'react';

import MobileSwitchLoading from '@/features/MobileSwitchLoading';
import { useIsMobile } from '@/hooks/useIsMobile';
import dynamic from '@/libs/next/dynamic';

interface ClientResponsiveLayoutProps {
  Desktop: FC<PropsWithChildren>;
  Mobile: Loader;
}

const ClientResponsiveLayout = ({ Desktop, Mobile }: ClientResponsiveLayoutProps) => {
  const MobileComponent = dynamic(Mobile, {
    loading: MobileSwitchLoading,
    ssr: false,
  }) as FC<PropsWithChildren>;

  const Layout = memo<PropsWithChildren>(({ children }) => {
    const mobile = useIsMobile();

    return mobile ? <MobileComponent>{children}</MobileComponent> : <Desktop>{children}</Desktop>;
  });

  Layout.displayName = 'ClientLayout';

  return Layout;
};

export default ClientResponsiveLayout;
