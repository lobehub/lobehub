'use client';

import { memo, type PropsWithChildren } from 'react';
import useSWR from 'swr';

import { SandboxWorkspaceUpgradeGuide } from '@/business/client/features/SandboxWorkspaceUpsell';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';

/**
 * Environments are specifications for a persistent workspace, so the page
 * that manages them is only useful to an account that has one. Without the
 * entitlement the page shows how to get one instead of a form whose result
 * nothing could ever run in.
 *
 * The entitlement is resolved and signed server-side; asking the server is the
 * only way to see the same answer the sandbox will act on. Same key as the
 * composer's working-directory chip, so the two never disagree.
 */
const EnvironmentsGate = memo<PropsWithChildren>(({ children }) => {
  const { data } = useSWR('sandbox-workspace-entitlement', () =>
    sandboxWorkspaceService.getEntitlement(),
  );

  // Nothing rather than a flash of the upgrade page at a user who turns out to
  // be entitled.
  if (!data) return <RouteLoading />;
  if (!data.entitled) return <SandboxWorkspaceUpgradeGuide />;

  return children;
});

EnvironmentsGate.displayName = 'EnvironmentsGate';

export default EnvironmentsGate;
