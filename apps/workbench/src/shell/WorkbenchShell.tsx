'use client';

import { ModalHost, ToastHost, TooltipGroup } from '@lobehub/ui/base-ui';
import { StyleProvider } from 'antd-style';
import { memo, type PropsWithChildren } from 'react';

import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import type { SPAServerConfig } from '@/types/spaServerConfig';

import WorkbenchLocale from './WorkbenchLocale';
import WorkbenchTheme from './WorkbenchTheme';

interface WorkbenchShellProps extends PropsWithChildren {
  locale?: string;
  resources?: Record<string, unknown>;
  serverConfig?: SPAServerConfig | null;
}

const WorkbenchShell = memo<WorkbenchShellProps>((props) => {
  const { children, resources } = props;

  const serverConfig: SPAServerConfig | undefined =
    props.serverConfig === undefined
      ? typeof window === 'undefined'
        ? undefined
        : window.__SERVER_CONFIG__
      : (props.serverConfig ?? undefined);

  const locale =
    props.locale ??
    (typeof document === 'undefined' ? 'en-US' : document.documentElement.lang || 'en-US');

  return (
    <WorkbenchLocale defaultLang={locale} resources={resources}>
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
