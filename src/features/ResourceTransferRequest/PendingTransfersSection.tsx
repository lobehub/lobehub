'use client';

import { AGENT_CHAT_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { Avatar, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { formatNotificationRelativeTime } from '@/features/HomeSidebar/Header/components/InboxDrawer/formatNotificationRelativeTime';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import type {
  PendingTransferRequest,
  TransferRequestParty,
} from '@/services/resourceTransferRequest';
import { resourceTransferRequestService } from '@/services/resourceTransferRequest';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { TransferErrorCode } from '@/types/transferError';

export const PENDING_TRANSFERS_SWR_KEY = 'pending-transfer-requests';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  section: css`
    padding-block: 8px 4px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const partyLabel = (party: TransferRequestParty | null, fallback: string) =>
  party?.fullName?.trim() || party?.username?.trim() || fallback;

/**
 * Actionable copy for the failures a still-rendered request can hit (recipient
 * downgraded/removed, migration still draining, resource changed). Falls back
 * to the generic toast for anything unmapped.
 */
const TRANSFER_ERROR_KEY_BY_CODE: Partial<Record<TransferErrorCode, string>> = {
  [TransferErrorCode.CopyInProgress]: 'error:transfer.copyInProgress',
  [TransferErrorCode.GroupHasInaccessibleMember]: 'error:transfer.groupHasInaccessibleMember',
  [TransferErrorCode.ResourceNotFound]: 'error:transfer.resourceNotFound',
  [TransferErrorCode.TargetNoWriteAccess]: 'error:transfer.targetNoWriteAccess',
  [TransferErrorCode.TargetNotWorkspaceMember]: 'error:transfer.targetNotWorkspaceMember',
  [TransferErrorCode.TransferInProgress]: 'error:transfer.transferInProgress',
  [TransferErrorCode.TransferRequestStale]: 'error:transfer.transferRequestStale',
};

const getActionFailedMessageKey = (error: unknown): string => {
  const code = (error as { data?: { errorData?: { code?: unknown } } } | null)?.data?.errorData
    ?.code;
  return (
    (typeof code === 'string' && TRANSFER_ERROR_KEY_BY_CODE[code as TransferErrorCode]) ||
    'agent:transferRequest.actionFailed'
  );
};

/**
 * i18n key per transferable type — a title alone can't tell an agent from a
 * group (or a future document) with the same name. Types without an entry
 * simply render no tag, so new resource types degrade gracefully.
 */
const RESOURCE_TYPE_LABEL_KEYS: Record<string, string> = {
  agent: 'transferRequest.resourceType.agent',
  agentGroup: 'transferRequest.resourceType.agentGroup',
};

/** Where "open what I just accepted" lands, per resource type. */
const RESOURCE_CHAT_URLS: Record<string, (id: string) => string> = {
  agent: AGENT_CHAT_URL,
  agentGroup: GROUP_CHAT_URL,
};

/**
 * Cross-resource transfer inbox at the top of the notification drawer: the one
 * place where a recipient answers a pending ownership handover and an
 * initiator can withdraw one. Driven by the live `listMine` query rather than
 * per-notification payloads, so resolved/expired/withdrawn requests simply
 * drop out — no stale action buttons to reconcile. Renders nothing outside a
 * workspace or when nothing is pending.
 */
const PendingTransfersSection = memo<{ onResolved?: () => void }>(({ onResolved }) => {
  const { i18n, t } = useTranslation(['agent', 'error']);
  // Same relative-time convention as the notification items below.
  const dateLocale = i18n.resolvedLanguage || i18n.language;
  const [actingId, setActingId] = useState<string | null>(null);

  const workspaceId = useActiveWorkspaceId();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const navigate = useWorkspaceAwareNavigate();

  const { data, mutate } = useClientDataSWR<PendingTransferRequest[]>(
    workspaceId ? [PENDING_TRANSFERS_SWR_KEY, workspaceId] : null,
    () => resourceTransferRequestService.listMine(),
  );

  if (!data || data.length === 0 || !currentUserId) return null;

  const run = async (
    request: PendingTransferRequest,
    action: () => Promise<unknown>,
    successMessage: string,
    { ownershipChanged }: { ownershipChanged?: boolean } = {},
  ) => {
    setActingId(request.id);
    let succeeded = false;
    // The item disappears from the list once resolved, so the toast is the
    // only remaining handle on "the thing I just accepted" — give it a way in.
    const toUrl =
      ownershipChanged && RESOURCE_CHAT_URLS[request.resourceType]
        ? RESOURCE_CHAT_URLS[request.resourceType](request.resourceId)
        : undefined;
    try {
      await action();
      succeeded = true;
      // Top placement + the action inlined into the title row: the `actions`
      // slot always renders on its own second line, and this message is short
      // enough to share one line with its button.
      toast.success(
        toUrl
          ? {
              placement: 'top',
              title: (
                <Flexbox horizontal align="center" gap={12}>
                  <span style={{ whiteSpace: 'nowrap' }}>{successMessage}</span>
                  <Button size="small" type="primary" onClick={() => navigate(toUrl)}>
                    {t('transferRequest.acceptedToastAction')}
                  </Button>
                </Flexbox>
              ),
            }
          : { placement: 'top', title: successMessage },
      );
    } catch (error) {
      console.error('[PendingTransfersSection] action failed', error);
      toast.error({ placement: 'top', title: t(getActionFailedMessageKey(error) as never) });
    } finally {
      setActingId(null);
      // Either way re-read: a raced/expired request must leave the list.
      await mutate();
      onResolved?.();
    }
    // An accepted handover flips ownership — the sidebar list, the agent map
    // and every owner-gated menu read from caches that must not wait for a
    // manual page reload.
    if (succeeded && ownershipChanged) {
      await useHomeStore.getState().refreshAgentList();
    }
  };

  const fallback = t('transferRequest.someone');

  return (
    <Flexbox className={styles.section} gap={8}>
      <Text fontSize={12} style={{ paddingInline: 4 }} type="secondary" weight={500}>
        {t('transferRequest.sectionTitle')}
      </Text>
      {data.map((request) => {
        const isRecipient = request.recipientId === currentUserId;
        const acting = actingId === request.id;
        const counterpartLabel = partyLabel(
          isRecipient ? request.initiator : request.recipient,
          fallback,
        );
        const resourceTitle =
          request.resource?.title?.trim() || t('transferRequest.untitledResource');
        const typeLabelKey = RESOURCE_TYPE_LABEL_KEYS[request.resourceType];

        return (
          <Flexbox className={styles.item} gap={8} key={request.id}>
            <Flexbox horizontal align="flex-start" gap={8} style={{ minWidth: 0 }}>
              <Avatar
                avatar={request.resource?.avatar || undefined}
                background={request.resource?.backgroundColor || undefined}
                size={24}
                style={{ flex: 'none' }}
                title={resourceTitle}
              />
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <Flexbox
                  horizontal
                  align="center"
                  gap={6}
                  justify="space-between"
                  style={{ minWidth: 0 }}
                >
                  <Text ellipsis fontSize={13} style={{ minWidth: 0 }} weight={500}>
                    {resourceTitle}
                  </Text>
                  {typeLabelKey && (
                    <Tag size="small" style={{ flexShrink: 0 }}>
                      {t(typeLabelKey as never)}
                    </Tag>
                  )}
                </Flexbox>
                <Text ellipsis fontSize={12} type="secondary">
                  {isRecipient
                    ? t('transferRequest.itemIncoming', { name: counterpartLabel })
                    : t('transferRequest.itemOutgoing', { name: counterpartLabel })}
                </Text>
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal align="center" gap={8} justify="space-between">
              {/* Indented past the avatar (24 + gap 8) so it lines up with the
                  text column, matching the notification items below. */}
              <Text fontSize={12} style={{ marginInlineStart: 32 }} type="secondary">
                {formatNotificationRelativeTime(request.createdAt, dateLocale)}
              </Text>
              <Flexbox horizontal gap={8}>
                {isRecipient ? (
                  <>
                    <Button
                      disabled={acting}
                      size="small"
                      onClick={() =>
                        run(
                          request,
                          () => resourceTransferRequestService.decline(request.id),
                          t('transferRequest.declinedToast'),
                        )
                      }
                    >
                      {t('transferRequest.decline')}
                    </Button>
                    <Button
                      loading={acting}
                      size="small"
                      type="primary"
                      onClick={() =>
                        run(
                          request,
                          () => resourceTransferRequestService.accept(request.id),
                          t('transferRequest.acceptedToast'),
                          { ownershipChanged: true },
                        )
                      }
                    >
                      {t('transferRequest.accept')}
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={acting}
                    loading={acting}
                    size="small"
                    onClick={() =>
                      run(
                        request,
                        () => resourceTransferRequestService.cancel(request.id),
                        t('transferRequest.withdrawnToast'),
                      )
                    }
                  >
                    {t('transferRequest.withdraw')}
                  </Button>
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

PendingTransfersSection.displayName = 'PendingTransfersSection';

export default PendingTransfersSection;
