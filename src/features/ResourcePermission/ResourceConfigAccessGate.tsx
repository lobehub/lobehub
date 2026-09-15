'use client';

import { toast } from '@lobehub/ui/base-ui';
import { memo, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';

import { useResourceAccess } from './useResourceAccess';

interface ResourceConfigAccessGateProps {
  children: ReactNode;
  loading?: ReactNode;
  redirectPath: string;
  resourceId?: string;
  resourceType: 'agent' | 'agentGroup';
}

const ResourceConfigAccessGate = memo<ResourceConfigAccessGateProps>(
  ({ children, loading, redirectPath, resourceId, resourceType }) => {
    const { t } = useTranslation('chat');
    const navigate = useWorkspaceAwareNavigate();
    const hasRedirected = useRef(false);
    const { allowed: canEditContent } = usePermission('edit_own_content');
    const { accessError, canEditResource, isAccessResolved, isLoading, retryAccess } =
      useResourceAccess(resourceType, resourceId);

    const accessReady = !!resourceId && isAccessResolved && !isLoading;
    const canConfigure = accessReady && canEditContent && canEditResource;

    useEffect(() => {
      if (!accessReady || accessError || canConfigure || hasRedirected.current) return;

      hasRedirected.current = true;
      // Name the actual reason: a workspace role that cannot configure Agents at
      // all reads very differently from holding use-only access on this one
      // resource, and conflating them made authors think their own Agent had
      // rejected them.
      const isRoleRestricted = !canEditContent;
      const messageKey =
        resourceType === 'agent'
          ? isRoleRestricted
            ? 'permission.configAccess.agentRoleRestricted'
            : 'permission.configAccess.agentChatOnly'
          : isRoleRestricted
            ? 'permission.configAccess.groupRoleRestricted'
            : 'permission.configAccess.groupChatOnly';
      toast.info(t(messageKey));
      navigate(redirectPath, { replace: true });
    }, [
      accessError,
      accessReady,
      canConfigure,
      canEditContent,
      navigate,
      redirectPath,
      resourceType,
      t,
    ]);

    return (
      <AsyncBoundary
        data={accessReady ? true : undefined}
        error={accessError}
        errorVariant={'page'}
        isLoading={!accessReady && !accessError}
        loading={loading ?? <SurfaceSkeleton variant={'form'} />}
        onRetry={() => void retryAccess()}
      >
        {canConfigure ? children : (loading ?? <SurfaceSkeleton variant={'form'} />)}
      </AsyncBoundary>
    );
  },
);

ResourceConfigAccessGate.displayName = 'ResourceConfigAccessGate';

export default ResourceConfigAccessGate;
