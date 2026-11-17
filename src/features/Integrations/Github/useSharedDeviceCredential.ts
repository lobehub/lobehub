import type { ScmCredentialGrantPath, ScmCredentialGrantResult } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { scmService } from '@/services/scm';

const POLICY_SWR_KEY = 'scm:requesterCredentialPolicy';

export const useRequesterCredentialPolicy = (onError?: () => void) => {
  const { data: policy, mutate } = useClientDataSWR(POLICY_SWR_KEY, () =>
    scmService.getRequesterCredentialPolicy(),
  );

  const toggle = useCallback(
    async (enabled: boolean) => {
      try {
        await mutate(
          async (current) => ({
            canEdit: current?.canEdit ?? true,
            ...(await scmService.updateRequesterCredentialPolicy(enabled)),
          }),
          {
            optimisticData: (current) => ({ canEdit: current?.canEdit ?? true, enabled }),
            rollbackOnError: true,
          },
        );
      } catch {
        onError?.();
      }
    },
    [mutate, onError],
  );

  return { policy, toggle };
};

export const useDisconnectGithubAccount = (onDone?: () => void) => {
  const { t } = useTranslation('integration');

  return useCallback(
    () =>
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('github.account.disconnectConfirm.content'),
        okButtonProps: { danger: true },
        okText: t('github.account.disconnect'),
        onOk: async () => {
          try {
            await scmService.disconnectIdentity('github');
            toast.success(t('github.account.disconnected'));
            onDone?.();
          } catch {
            toast.error(t('github.account.disconnectFailed'));
          }
        },
        title: t('github.account.disconnectConfirm.title'),
      }),
    [onDone, t],
  );
};

interface GrantRow {
  path: ScmCredentialGrantPath;
  repo: string | null;
  requester: { avatar: string | null; id: string; name: string | null };
  result: ScmCredentialGrantResult;
}

export const describeGrant = (grant: GrantRow, t: (key: string) => string) => ({
  name: grant.requester.name ?? grant.requester.id,
  path: t(`github.grants.path.${grant.path}`),
  repo: grant.repo ?? t('github.grants.noRepo'),
  result: t(`github.grants.result.${grant.result}`),
  tone: grant.result === 'issued' ? ('success' as const) : ('warning' as const),
});

export const githubAccountState = (identity: { needsReauthorization: boolean } | null) => {
  if (!identity) return 'none' as const;
  return identity.needsReauthorization ? ('reauthorize' as const) : ('ready' as const);
};

const GRANTS_PAGE_SIZE = 50;

export interface CredentialGrantFilters {
  repo?: string;
  requesterUserId?: string;
}

export const useCredentialGrants = ({ repo, requesterUserId }: CredentialGrantFilters) => {
  const workspaceId = useActiveWorkspaceId();
  const { data, error, isLoading, isValidating, mutate, setSize, size } = useSWRInfinite(
    (index, previous: Awaited<ReturnType<typeof scmService.listCredentialGrants>> | null) => {
      if (previous && previous.length < GRANTS_PAGE_SIZE) return null;
      const before = index === 0 ? null : previous?.at(-1)?.createdAt;
      return [
        'scm:credentialGrants',
        workspaceId,
        repo ?? '',
        requesterUserId ?? '',
        before,
      ] as const;
    },
    ([, , pageRepo, pageRequester, before]) =>
      scmService.listCredentialGrants({
        before: before ?? undefined,
        limit: GRANTS_PAGE_SIZE,
        repo: pageRepo || undefined,
        requesterUserId: pageRequester || undefined,
      }),
    { revalidateFirstPage: false },
  );

  return {
    error,
    grants: data?.flat() ?? [],
    hasMore: (data?.at(-1)?.length ?? 0) === GRANTS_PAGE_SIZE,
    isLoading,
    isLoadingMore: isValidating && size > (data?.length ?? 0),
    loadMore: () => setSize(size + 1),
    mutate,
  };
};
