'use client';

import { toast } from '@lobehub/ui';
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';

import { getAccessRequestGeneration, useResourceAccess } from './useResourceAccess';

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
    const hasRequestedCheck = useRef<string | null>(null);
    // Only a check issued after this gate opened the resource may justify a
    // redirect: a denial confirmed earlier in the session (e.g. by a sidebar
    // row) can predate a grant made since.
    // Compared by request generation, not wall-clock time: two requests can
    // share a millisecond, but only one issued after opening has a larger one.
    const [opened, setOpened] = useState(() => ({
      generation: getAccessRequestGeneration(),
      key: resourceKey,
    }));
    if (opened.key !== resourceKey) {
      setOpened({ generation: getAccessRequestGeneration(), key: resourceKey });
    }
    const openedGeneration =
      opened.key === resourceKey ? opened.generation : Number.POSITIVE_INFINITY;
    const { allowed: canEditContent } = usePermission('edit_own_content');
    const {
      accessError,
      canEditResource,
      canManageResource,
      confirmedGeneration,
      isAccessConfirmed,
      isAccessResolved,
      isValidating,
      retryAccess,
    } = useResourceAccess(resourceType, resourceId);

    // Stale-first: a cached grant renders the config page immediately while the
    // access record revalidates (the server still checks every write). A
    // denial only redirects once this session has re-confirmed it, so an
    // outdated cached denial cannot bounce a user who was just granted access.
    const accessReady = !!resourceId && isAccessResolved;
    const canConfigure =
      accessReady &&
      canEditContent &&
      (requiredAccess === 'manage' ? canManageResource : canEditResource);
    const isBlocked = accessReady && !canConfigure;
    const isFreshlyConfirmed =
      isAccessConfirmed &&
      confirmedGeneration !== undefined &&
      confirmedGeneration > openedGeneration;
    const denialConfirmed = isBlocked && isFreshlyConfirmed;

    // A deduped mount revalidation may never re-check a session-confirmed
    // denial, which would leave the gate waiting; request the check once.
    useEffect(() => {
      if (!isBlocked || isFreshlyConfirmed || isValidating || accessError) return;
      if (hasRequestedCheck.current === resourceKey) return;
      hasRequestedCheck.current = resourceKey;
      void retryAccess();
    }, [accessError, isBlocked, isFreshlyConfirmed, isValidating, resourceKey, retryAccess]);

    useEffect(() => {
      if (!denialConfirmed || accessError || hasRedirected.current === resourceKey) return;

      hasRedirected.current = resourceKey;
      // Name the actual reason: a workspace role that cannot configure Agents at
      // all reads very differently from holding use-only access on this one
      // resource, and conflating them made authors think their own Agent had
      // rejected them.
      const isRoleRestricted = !canEditContent;
      const isManagementRestricted =
        requiredAccess === 'manage' && canEditResource && !canManageResource;
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
      accessError,
      canEditContent,
      canEditResource,
      canManageResource,
      denialConfirmed,
      navigate,
      redirectPath,
      requiredAccess,
      resourceKey,
      resourceType,
      t,
    ]);

    return (
      // Settled only once the page can render: a cached denial or an
      // unconfirmed manage grant is still blocked, and if its re-check fails
      // the error page (with Retry) must show instead of an endless skeleton.
      <AsyncBoundary
        data={canConfigure ? true : undefined}
        error={accessError}
        errorVariant={'page'}
        // SWR keeps the previous error while Retry revalidates; show progress
        // then instead of a still-clickable Retry.
        isLoading={!canConfigure && (!accessError || isValidating)}
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
