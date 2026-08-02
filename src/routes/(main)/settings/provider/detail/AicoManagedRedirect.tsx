'use client';

import type { ReactNode } from 'react';
import { Navigate } from 'react-router';

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

type Props = {
  children?: ReactNode;
  /** Rendered when not in managed mode. */
  fallback: ReactNode;
  /** Current provider route id (`all`, `openai`, `openrouter`, …). */
  id?: string | null;
};

const ALLOWED = new Set(['openrouter', 'aico']);

/**
 * When Aico managed billing is on, bounce every other provider surface
 * (including `/settings/provider/all`) to the branded OpenRouter detail.
 * Defaults to managed (fail-closed) so the catalog never flashes.
 */
const AicoManagedRedirect = ({ children, fallback, id }: Props) => {
  const { data: managedStatus } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );

  const aicoManaged = managedStatus?.managed ?? true;
  if (!aicoManaged) return <>{children ?? fallback}</>;

  const runtimeId = managedStatus?.runtimeProviderId ?? 'openrouter';
  if (!id || id === 'all' || !ALLOWED.has(id)) {
    const to = buildWorkspaceAwarePath(`/settings/provider/${runtimeId}`, getActiveWorkspaceSlug());
    return <Navigate replace to={to} />;
  }

  return <>{children ?? fallback}</>;
};

export default AicoManagedRedirect;
