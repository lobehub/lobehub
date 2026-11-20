'use client';

import { toast } from '@lobehub/ui';
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
  requiredAccess?: 'edit' | 'manage';
  resourceId?: string;
  resourceType: 'agent' | 'agentGroup';
}

const ResourceConfigAccessGate = memo<ResourceConfigAccessGateProps>(
  ({ children, loading, redirectPath, requiredAccess = 'edit', resourceId, resourceType }) => {
    const { t } = useTranslation('chat');
    const navigate = useWorkspaceAwareNavigate();
    // Router reuses this gate across resources (`/agent/A/profile` →
    // `/agent/B/profile`), so the lifecycle below is per resource, not per mount.
    const resourceKey = `${resourceType}:${resourceId}`;
    const hasRedirected = useRef<string | null>(null);
    const { allowed: canEditContent } = usePermission('edit_own_content');
    const { access, accessError, canEditResource, isAccessResolved, retryAccess } =
      useResourceAccess(resourceType, resourceId);

    // Decide from the access record on screen, persisted or fresh: a reload
    // opens the config page (or returns a chat-only caller to chat) at once
    // while the record revalidates. A grant the server has since withdrawn is
    // still rejected on every write, and the revalidation then redirects; a
    // denial that has since been lifted only costs one bounce, because the
    // chat page re-syncs the record. Management counts the record's grant too;
    // the page's own destructive controls wait for a confirmed one. Without a
    // record (personal mode, or a denial) it follows the edit check.
    const canManage = access?.canManage ?? canEditResource;
    const accessReady = !!resourceId && isAccessResolved;
    const canConfigure =
      accessReady && canEditContent && (requiredAccess === 'manage' ? canManage : canEditResource);
    const isBlocked = accessReady && !canConfigure;

    useEffect(() => {
      if (!isBlocked || hasRedirected.current === resourceKey) return;

      hasRedirected.current = resourceKey;
      // Name the actual reason: a workspace role that cannot configure Agents at
      // all reads very differently from holding use-only access on this one
      // resource, and conflating them made authors think their own Agent had
      // rejected them.
      const isRoleRestricted = !canEditContent;
      const isManagementRestricted = requiredAccess === 'manage' && canEditResource && !canManage;
      const messageKey =
        resourceType === 'agent'
          ? isRoleRestricted
            ? 'permission.configAccess.agentRoleRestricted'
            : isManagementRestricted
              ? 'permission.configAccess.agentManageRestricted'
              : 'permission.configAccess.agentChatOnly'
          : isRoleRestricted
            ? 'permission.configAccess.groupRoleRestricted'
            : 'permission.configAccess.groupChatOnly';
      toast.info(t(messageKey));
      navigate(redirectPath, { replace: true });
    }, [
      canEditContent,
      canEditResource,
      canManage,
      isBlocked,
      navigate,
      redirectPath,
      requiredAccess,
      resourceKey,
      resourceType,
      t,
    ]);

    // Skeleton only while there is no record to decide from; a failed first
    // load shows the error page with Retry. A blocked caller is redirected by
    // the effect above, so nothing renders for that frame.
    const fallback = loading ?? <SurfaceSkeleton variant={'form'} />;

    return (
      <AsyncBoundary
        data={accessReady ? true : undefined}
        error={accessReady ? undefined : accessError}
        errorVariant={'page'}
        isLoading={!accessReady && !accessError}
        loading={fallback}
        onRetry={() => void retryAccess()}
      >
        {canConfigure ? children : null}
      </AsyncBoundary>
    );
  },
);

ResourceConfigAccessGate.displayName = 'ResourceConfigAccessGate';

export default ResourceConfigAccessGate;
