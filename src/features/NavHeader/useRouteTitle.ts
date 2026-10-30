import { useTranslation } from 'react-i18next';

import { getRouteTitleNamespaces } from './routeTitle';

/**
 * Translates a route `titleKey`, loading the namespace it names. Undefined
 * until that namespace is ready, so the header never flashes the raw key.
 */
export const useRouteTitle = (titleKey: string | undefined): string | undefined => {
  const { ready, t } = useTranslation(
    // A route title names its namespace in the key, so it is only known at runtime.
    getRouteTitleNamespaces(titleKey) as Parameters<typeof useTranslation>[0],
  );

  return titleKey && ready ? t(titleKey as any) : undefined;
};
