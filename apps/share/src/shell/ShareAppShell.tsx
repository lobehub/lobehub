'use client';

import { ModalHost, ToastHost, TooltipGroup } from '@lobehub/ui/base-ui';
import { StyleProvider } from 'antd-style';
import { memo, type PropsWithChildren } from 'react';

import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import type { SPAServerConfig } from '@/types/spaServerConfig';

import { type ShareResources } from './createShareI18n';
import ShareLocale from './ShareLocale';
import ShareTheme from './ShareTheme';

interface ShareAppShellProps extends PropsWithChildren {
  locale?: string;
  resources?: ShareResources;
  serverConfig?: SPAServerConfig | null;
}

const ShareAppShell = memo<ShareAppShellProps>((props) => {
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
    <ShareLocale defaultLang={locale} resources={resources}>
      <ShareTheme>
        <ServerConfigStoreProvider
          featureFlags={serverConfig?.featureFlags}
          serverConfig={serverConfig?.config}
        >
          <TooltipGroup layoutAnimation={false}>
            <StyleProvider speedy={import.meta.env.PROD}>{children}</StyleProvider>
          </TooltipGroup>
          <ModalHost />
          <ToastHost />
        </ServerConfigStoreProvider>
      </ShareTheme>
    </ShareLocale>
  );
});

ShareAppShell.displayName = 'ShareAppShell';

export default ShareAppShell;
