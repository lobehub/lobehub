'use client';

import { ModalHost, ToastHost, TooltipGroup } from '@lobehub/ui/base-ui';
import { StyleProvider } from 'antd-style';
import { memo, type PropsWithChildren } from 'react';

import { DEFAULT_LANG } from '@/const/locale';

import ControlPlaneLocale from './ControlPlaneLocale';
import ControlPlaneTheme from './ControlPlaneTheme';

const ControlPlaneShell = memo<PropsWithChildren>(({ children }) => {
  const locale = document.documentElement.lang || DEFAULT_LANG;

  return (
    <ControlPlaneLocale defaultLang={locale}>
      <ControlPlaneTheme>
        <TooltipGroup layoutAnimation={false}>
          <StyleProvider speedy={import.meta.env.PROD}>{children}</StyleProvider>
        </TooltipGroup>
        <ModalHost />
        <ToastHost />
      </ControlPlaneTheme>
    </ControlPlaneLocale>
  );
});

ControlPlaneShell.displayName = 'ControlPlaneShell';

export default ControlPlaneShell;
