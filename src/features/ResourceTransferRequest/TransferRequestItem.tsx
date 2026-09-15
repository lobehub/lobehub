'use client';

import { AGENT_CHAT_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { Block, Flexbox } from '@lobehub/ui';
import { Avatar, Button, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatNotificationRelativeTime } from '@/features/HomeSidebar/Header/components/InboxModal/formatNotificationRelativeTime';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import type {
  PendingTransferRequest,
  TransferRequestParty,
  TransferRequestResourceType,
} from '@/services/resourceTransferRequest';
import { resourceTransferRequestService } from '@/services/resourceTransferRequest';
import { TransferErrorCode } from '@/types/transferError';

import { isTransferManifestActionable } from './manifestState';
import { refreshCachesAfterOwnershipChange } from './refreshAfterOwnershipChange';
import TransferManifestList from './TransferManifestList';

const partyLabel = (party: TransferRequestParty | null, fallback: string) =>
  party?.fullName?.trim() || party?.username?.trim() || fallback;

/**
 * Actionable copy for the failures a still-rendered request can hit (recipient
 * downgraded/removed, migration still draining, resource changed). Falls back
 * to the generic toast for anything unmapped.
 */
const TRANSFER_ERROR_KEY_BY_CODE: Partial<Record<TransferErrorCode, string>> = {
  [TransferErrorCode.AgentOwnedByGroup]: 'error:transfer.agentOwnedByGroup',
  [TransferErrorCode.CopyInProgress]: 'error:transfer.copyInProgress',
  [TransferErrorCode.GroupHasInaccessibleMember]: 'error:transfer.groupHasInaccessibleMember',
  [TransferErrorCode.ResourceNotFound]: 'error:transfer.resourceNotFound',
  [TransferErrorCode.SharedTransferBlocked]: 'error:transfer.sharedTransferBlocked',
  [TransferErrorCode.TargetNoWriteAccess]: 'error:transfer.targetNoWriteAccess',
  [TransferErrorCode.TargetNotWorkspaceMember]: 'error:transfer.targetNotWorkspaceMember',
  [TransferErrorCode.TransferInProgress]: 'error:transfer.transferInProgress',
  [TransferErrorCode.TransferRequestExpired]: 'error:transfer.transferRequestExpired',
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
 * Request ids with an action currently in flight. Module-scoped (not component
 * state) so the lock survives the item unmounting — switching tabs or closing
 * the modal mid-action must not let a remounted card submit a duplicate.
 */
const actingRequestIds = new Set<string>();

export interface TransferRequestItemProps {
  currentUserId: string;
  /**
   * Called after any action settles (whichever way): the owner re-reads the
   * live request list so resolved/raced/expired requests drop out and the
   * inbox counts refresh.
   */
  onSettled: (request: PendingTransferRequest, succeeded: boolean) => Promise<void> | void;
  request: PendingTransferRequest;
}

/**
 * One live transfer request rendered in notification-item form inside the
 * inbox list. Driven by the live request rather than the immutable
 * notification row, so resolved/expired/withdrawn requests simply drop out —
 * no stale action buttons to reconcile. The recipient answers here; the
 * initiator can withdraw.
 */
const TransferRequestItem = memo<TransferRequestItemProps>(
  ({ currentUserId, onSettled, request }) => {
    const { i18n, t } = useTranslation(['agent', 'error']);
    const dateLocale = i18n.resolvedLanguage || i18n.language;
    const navigate = useWorkspaceAwareNavigate();
    // Stays true after a successful action until the refreshed list unmounts
    // this item — a failed refresh must not re-enable a duplicate submission.
    // A failed action resets it so the user can retry. Seeded from the
    // module-level set so a remounted card restores an in-flight lock.
    const [acting, setActingState] = useState(() => actingRequestIds.has(request.id));
    const setActing = (value: boolean) => {
      if (value) actingRequestIds.add(request.id);
      else actingRequestIds.delete(request.id);
      setActingState(value);
    };

    const isRecipient = request.recipientId === currentUserId;

    // Accept is gated until the manifest loads successfully without a blocker:
    // a failed/unknown impact summary must never turn into permission to act.
    const {
      data: manifest,
      error: manifestError,
      isValidating: isManifestValidating,
      mutate: mutateManifest,
    } = useClientDataSWR(
      isRecipient ? `transfer-manifest-${request.id}` : null,
      () =>
        resourceTransferRequestService.getManifest({
          recipientId: request.recipientId,
          resourceId: request.resourceId,
          resourceType: request.resourceType as TransferRequestResourceType,
        }),
      { revalidateOnFocus: false },
    );
    const manifestReady = isTransferManifestActionable(manifest, manifestError);

    const fallback = t('transferRequest.someone');
    const counterpartLabel = partyLabel(
      isRecipient ? request.initiator : request.recipient,
      fallback,
    );
    const resourceTitle = request.resource?.title?.trim() || t('transferRequest.untitledResource');
    const typeLabelKey = RESOURCE_TYPE_LABEL_KEYS[request.resourceType];

    const run = async (
      action: () => Promise<unknown>,
      success: { description?: string; title: string },
      { ownershipChanged }: { ownershipChanged?: boolean } = {},
    ) => {
      setActing(true);
      // The item disappears from the list once resolved, so the toast is the
      // only remaining handle on "the thing I just accepted" — give it a way in.
      const toUrl =
        ownershipChanged && RESOURCE_CHAT_URLS[request.resourceType]
          ? RESOURCE_CHAT_URLS[request.resourceType](request.resourceId)
          : undefined;
      let succeeded = false;
      try {
        await action();
        succeeded = true;
        toast.success({
          actions: toUrl
            ? [
                {
                  label: t('transferRequest.acceptedToastAction'),
                  onClick: () => navigate(toUrl),
                },
              ]
            : undefined,
          description: success.description,
          placement: 'top',
          title: success.title,
        });
      } catch (error) {
        console.error('[TransferRequestItem] action failed', error);
        toast.error({ placement: 'top', title: t(getActionFailedMessageKey(error) as never) });
        setActing(false);
      }
      // Either way the owner re-reads: a raced/expired request must leave the
      // list. Settle failures self-heal on the next revalidation.
      try {
        await onSettled(request, succeeded);
      } catch (error) {
        console.error('[TransferRequestItem] settle refresh failed', error);
      }
      if (succeeded && ownershipChanged) {
        await refreshCachesAfterOwnershipChange(request.resourceType, request.resourceId).catch(
          (error) => console.error('[TransferRequestItem] detail refresh failed', error),
        );
      }
    };

    return (
      <Block
        aria-label={resourceTitle}
        gap={4}
        paddingBlock={12}
        paddingInline={20}
        variant="borderless"
      >
        {/* No unread dot: it is not clearable by clicking (a pending item is
            "unread" until acted on), and a dot that ignores clicks reads as
            broken. The Pending badge and the action buttons carry the
            "awaiting you" signal. */}
        <Flexbox horizontal align="flex-start" gap={12}>
          <Avatar
            avatar={request.resource?.avatar || undefined}
            background={request.resource?.backgroundColor || undefined}
            shape="circle"
            size={32}
            style={{ flex: 'none' }}
            title={resourceTitle}
          />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
            <Flexbox
              horizontal
              align="center"
              gap={6}
              justify="space-between"
              style={{ minWidth: 0 }}
            >
              <Text ellipsis style={{ minWidth: 0 }} weight={500}>
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
        {isRecipient && (
          // The transfer's impact summary: what arrives disabled (bots, cron
          // jobs), what resets (device binding), what detaches (others' task
          // assignments). The recipient must see this BEFORE accepting.
          // Indented past the avatar (32 + gap 12) to line up with the text
          // column, matching the timestamp row below.
          <TransferManifestList
            error={manifestError}
            loading={!manifest && !manifestError}
            manifest={manifest}
            perspective="recipient"
            retrying={isManifestValidating}
            style={{ marginInlineStart: 44 }}
            onRetry={() =>
              void mutateManifest().catch((error) =>
                console.error('[TransferRequestItem] manifest retry failed', error),
              )
            }
          />
        )}
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <Text fontSize={12} style={{ marginInlineStart: 44 }} type="secondary">
            {formatNotificationRelativeTime(request.createdAt, dateLocale)}
          </Text>
          <Flexbox horizontal gap={8}>
            {isRecipient ? (
              <>
                <Button
                  disabled={acting}
                  size="small"
                  onClick={() =>
                    run(() => resourceTransferRequestService.decline(request.id), {
                      description: t('transferRequest.declinedToastDesc', { name: resourceTitle }),
                      title: t('transferRequest.declinedToast'),
                    })
                  }
                >
                  {t('transferRequest.decline')}
                </Button>
                <Button
                  disabled={acting || !manifestReady}
                  loading={acting}
                  size="small"
                  type="primary"
                  onClick={() =>
                    run(
                      () => resourceTransferRequestService.accept(request.id),
                      {
                        description: t('transferRequest.acceptedToastDesc', {
                          name: resourceTitle,
                        }),
                        title: t('transferRequest.acceptedToast'),
                      },
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
                  run(() => resourceTransferRequestService.cancel(request.id), {
                    title: t('transferRequest.withdrawnToast'),
                  })
                }
              >
                {t('transferRequest.withdraw')}
              </Button>
            )}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

TransferRequestItem.displayName = 'TransferRequestItem';

export default TransferRequestItem;
