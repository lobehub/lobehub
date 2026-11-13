'use client';

import NotFound from '@/components/404';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import AutomationList from './AutomationList';
import { resolveAutomationsGate } from './gate';
import AutomationsSkeleton from './Skeleton';

/**
 * The automations page body, shared by personal (`/settings/automations`) and
 * workspace (`/:slug/settings/automations`) settings — the list is scoped by
 * the active workspace, not by which page mounts it.
 */
const Automations = () => {
  const gate = useServerConfigStore((s) =>
    resolveAutomationsGate({
      enableMcpEvents: serverConfigSelectors.enableMcpEvents(s),
      serverConfigInit: s.serverConfigInit,
    }),
  );

  if (gate === 'loading') return <AutomationsSkeleton />;
  if (gate === 'notFound') return <NotFound />;

  return <AutomationList />;
};

export default Automations;
