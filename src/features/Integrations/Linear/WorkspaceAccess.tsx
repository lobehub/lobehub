'use client';

import { toast } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';

import { IntegrationConnectionsSkeleton } from '../Skeleton';
import { useInstallResult } from '../useInstallResult';
import { useLinearIntegration } from '../useLinearIntegration';
import Connections from './Connections';
import { buildLinearInstallHref } from './installHref';

const KNOWN_ERRORS = new Set([
  'access_denied',
  'exchange_failed',
  'invalid_state',
  'missing_code',
  'save_failed',
  'workspace_forbidden',
]);

/**
 * The connected Linear workspaces that projects import issues from. Connecting
 * hands off to the server route that owns the OAuth handshake; Linear sends the
 * user back with the outcome in the query.
 */
const WorkspaceAccess = memo(() => {
  const { t, ready } = useTranslation('integration');
  const appOrigin = useAppOrigin();
  const workspaceSlug = useActiveWorkspaceSlug();
  const workspaceId = useActiveWorkspaceId();
  const scope = workspaceSlug ? 'workspace' : 'personal';
  // The server only lets members and up bind or remove a workspace connection.
  const { allowed: canWrite, reason: blockedReason } = usePermission('create_content');
  const data = useLinearIntegration();

  useInstallResult(ready, ({ account, error, installed }) => {
    if (installed === 'ok') toast.success(t('linear.installResult.success', { account }));
    else if (error && KNOWN_ERRORS.has(error)) {
      toast.error(t(`linear.installResult.error.${error}` as any));
    } else if (error) toast.error(t('linear.installResult.error.unknown', { code: error }));
  });

  if (data.error && data.isInitialLoading)
    return <AsyncError error={data.error} variant={'block'} onRetry={data.mutate} />;

  if (data.isInitialLoading)
    return <IntegrationConnectionsSkeleton title={t('linear.connections.title')} />;

  const { config, connections } = data;
  const installHref =
    canWrite && config?.enabled && config.installPath
      ? buildLinearInstallHref(config.installPath, { appOrigin, workspaceId, workspaceSlug })
      : undefined;

  return (
    <Connections
      blockedReason={blockedReason}
      configured={!!config?.enabled}
      connections={connections}
      installHref={installHref}
      scope={scope}
      onChanged={data.mutate}
    />
  );
});

WorkspaceAccess.displayName = 'LinearWorkspaceAccess';

export default WorkspaceAccess;
