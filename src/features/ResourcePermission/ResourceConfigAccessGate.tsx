'use client';

import { toast } from '@lobehub/ui/base-ui';
import { memo, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';

import { useResourceAccess } from './useResourceAccess';

interface ResourceConfigAccessGateProps {
  children: ReactNode;
  redirectPath: string;
  resourceId?: string;
  resourceType: 'agent' | 'agentGroup';
}

const ResourceConfigAccessGate = memo<ResourceConfigAccessGateProps>(
  ({ children, redirectPath, resourceId, resourceType }) => {
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
      toast.info(
        t(
          resourceType === 'agent'
            ? 'permission.configAccess.agentChatOnly'
            : 'permission.configAccess.groupChatOnly',
        ),
      );
      navigate(redirectPath, { replace: true });
    }, [accessError, accessReady, canConfigure, navigate, redirectPath, resourceType, t]);

    return (
      <AsyncBoundary
        data={accessReady ? true : undefined}
        error={accessError}
        errorVariant={'page'}
        isLoading={!accessReady && !accessError}
        loading={<Loading debugId="ResourceConfigAccessGate" />}
        onRetry={() => void retryAccess()}
      >
        {canConfigure ? children : <Loading debugId="ResourceConfigAccessRedirect" />}
      </AsyncBoundary>
    );
  },
);

ResourceConfigAccessGate.displayName = 'ResourceConfigAccessGate';

export default ResourceConfigAccessGate;
