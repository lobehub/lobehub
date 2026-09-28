'use client';

import { type PropsWithChildren, useEffect, useState } from 'react';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';

import {
  type AcceptanceEmbedTheme,
  applyAcceptanceConfiguration,
  getReferrerOrigin,
  parseAcceptanceConfigureMessage,
} from './acceptanceEmbed';
import WorkbenchShell from './WorkbenchShell';

interface AcceptanceEmbedShellProps extends PropsWithChildren {
  embed: boolean;
  initialLocale?: string;
  initialTheme?: AcceptanceEmbedTheme;
  resources?: Record<string, unknown>;
}

const AcceptanceEmbedShell = ({
  children,
  embed,
  initialLocale = 'en-US',
  initialTheme,
  resources,
}: AcceptanceEmbedShellProps) => {
  const [locale, setLocale] = useState(initialLocale);
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => setLocale(initialLocale), [initialLocale]);
  useEffect(() => setTheme(initialTheme), [initialTheme]);

  useEffect(() => {
    if (!embed || window.parent === window) return;

    const trustedOrigin = getReferrerOrigin(document.referrer);
    if (!trustedOrigin) return;

    const handleMessage = (event: MessageEvent) => {
      const config = parseAcceptanceConfigureMessage(event, window.parent, trustedOrigin);
      if (!config) return;

      applyAcceptanceConfiguration(config, document.documentElement, (nextConfig) => {
        setLocale(nextConfig.locale);
        setTheme(nextConfig.theme);
      });
    };

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: 'lobehub:acceptance:ready' }, trustedOrigin);

    return () => window.removeEventListener('message', handleMessage);
  }, [embed]);

  return (
    <NextThemeProvider forcedTheme={embed ? theme : undefined}>
      <WorkbenchShell locale={locale} resources={resources}>
        {children}
      </WorkbenchShell>
    </NextThemeProvider>
  );
};

export default AcceptanceEmbedShell;
