'use client';

import { ModalHost, ToastHost, TooltipGroup } from '@lobehub/ui/base-ui';
import { StyleProvider } from 'antd-style';
import { memo, type PropsWithChildren } from 'react';

import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import type { SPAServerConfig } from '@/types/spaServerConfig';

import WorkbenchLocale from './WorkbenchLocale';
import WorkbenchTheme from './WorkbenchTheme';

const WorkbenchShell = memo<PropsWithChildren>(({ children }) => {
  const serverConfig: SPAServerConfig | undefined = window.__SERVER_CONFIG__;
  const locale = document.documentElement.lang || 'en-US';

  return (
    <WorkbenchLocale defaultLang={locale}>
      <WorkbenchTheme>
        <ServerConfigStoreProvider
          isMobile
          featureFlags={serverConfig?.featureFlags}
          serverConfig={serverConfig?.config}
        >
          <TooltipGroup layoutAnimation={false}>
            <StyleProvider speedy={import.meta.env.PROD}>{children}</StyleProvider>
          </TooltipGroup>
          <ModalHost />
          <ToastHost />
        </ServerConfigStoreProvider>
      </WorkbenchTheme>
    </WorkbenchLocale>
  );
});

WorkbenchShell.displayName = 'WorkbenchShell';

export default WorkbenchShell;
