'use client';

import { LayersEnum } from '@lobechat/types';
import { createStaticStyles, Icon, toast } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import type { LucideIcon } from 'lucide-react';
import { Brain, ClipboardCheck } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PortalResourceCard from '@/features/Conversation/components/PortalResourceCard';
import {
  getMemoryDetailPath,
  hasMemoryDetailView,
} from '@/features/Portal/MemoryDetail/memoryDetailRoutes';
import { useStableNavigate } from '@/hooks/useStableNavigate';
import { mutate } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { agentSignalService } from '@/services/agentSignal';
import { useChatStore } from '@/store/chat';

import type { AgentSignalReceiptView } from '../hooks/useAgentSignalReceipts';

const styles = createStaticStyles(({ css }) => ({
  list: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    width: 100%;
    margin-block-start: 8px;
  `,
}));

const RECEIPT_LUCIDE_ICON_BY_KIND = {
  memory: Brain,
  review: ClipboardCheck,
} as const satisfies Partial<Record<AgentSignalReceiptView['kind'], LucideIcon>>;

const LEGACY_PREFERENCE_MEMORY_PATTERN = /\bprefer(?:s|red|ence)?\b|偏好|喜好/i;

type ReceiptRollbackStatus =
  | 'already_rolled_back'
  | 'available'
  | 'conflict'
  | 'failed'
  | 'not_found'
  | 'pending'
  | 'rolled_back'
  | 'unsupported';

const RECEIPT_ROLLBACK_LABEL_BY_STATUS = {
  already_rolled_back: 'Rolled back',
  available: 'Undo',
  conflict: 'Conflict',
  failed: 'Failed',
  not_found: 'Not found',
  pending: 'Rolling back',
  rolled_back: 'Rolled back',
  unsupported: 'Unsupported',
} as const satisfies Record<ReceiptRollbackStatus, string>;

const RECEIPT_ROLLBACK_ERROR_FALLBACK = {
  conflict: "Can't undo: it was changed after this update",
  not_found: "Can't undo: it no longer exists",
  unsupported: "This change can't be undone",
} as const;

const renderReceiptIcon = (kind: AgentSignalReceiptView['kind']) => {
  if (kind === 'skill') return <SkillsIcon size={28} />;
  const LucideIconComponent = RECEIPT_LUCIDE_ICON_BY_KIND[kind];
  return LucideIconComponent ? <Icon icon={LucideIconComponent} size={28} /> : null;
};

interface AgentSignalReceiptListProps {
  receipts: AgentSignalReceiptView[];
}

interface AgentSignalReceiptItemProps {
  onRollbackStatusChange: (receiptId: string, status: ReceiptRollbackStatus) => void;
  receipt: AgentSignalReceiptView;
  rollbackStatus?: ReceiptRollbackStatus;
}

/**
 * Resolves where a memory receipt opens. Receipts carrying a layer + row id open that memory's
 * detail in the Portal; older receipts without that metadata fall back to the memory page.
 */
const getMemoryOpenTarget = (
  target?: AgentSignalReceiptView['target'],
):
  | { id: string; layer: LayersEnum; type: 'portal' }
  | { path: string; type: 'route' }
  | undefined => {
  if (target?.type !== 'memory') return;

  if (target.memoryLayer && target.id && hasMemoryDetailView(target.memoryLayer)) {
    return { id: target.id, layer: target.memoryLayer, type: 'portal' };
  }

  const memoryLayer =
    target.memoryLayer ??
    (LEGACY_PREFERENCE_MEMORY_PATTERN.test(`${target.title ?? ''} ${target.summary ?? ''}`)
      ? LayersEnum.Preference
      : undefined);

  return { path: memoryLayer ? getMemoryDetailPath(memoryLayer) : '/memory', type: 'route' };
};

const getRollbackStatusLabelKey = (
  status: ReceiptRollbackStatus,
  kind: AgentSignalReceiptView['kind'],
) => {
  if (status === 'available') return 'agentSignal.receipts.revert.undo';
  // An undone memory is deleted, not restored to an earlier version.
  if ((status === 'already_rolled_back' || status === 'rolled_back') && kind === 'memory') {
    return 'agentSignal.receipts.revert.undone';
  }
  if (status === 'already_rolled_back') return 'agentSignal.receipts.revert.rolled_back';

  return `agentSignal.receipts.revert.${status}`;
};

const ROLLBACK_SUCCESS_STATUSES = new Set<ReceiptRollbackStatus>([
  'already_rolled_back',
  'rolled_back',
]);

const normalizeRollbackStatus = (status: string): ReceiptRollbackStatus => {
  if (
    status === 'already_rolled_back' ||
    status === 'conflict' ||
    status === 'not_found' ||
    status === 'rolled_back' ||
    status === 'unsupported'
  ) {
    return status;
  }

  return 'failed';
};

const AgentSignalReceiptItem = memo<AgentSignalReceiptItemProps>(
  ({ receipt, rollbackStatus, onRollbackStatusChange }) => {
    const { t } = useTranslation(['chat', 'common']);
    const navigate = useStableNavigate();
    const openDocument = useChatStore((s) => s.openDocument);
    const openMemoryDetail = useChatStore((s) => s.openMemoryDetail);
    const rollbackInFlightRef = useRef(false);
    const iconNode = renderReceiptIcon(receipt.kind);
    const target = receipt.target;
    // Titles are localized by receipt kind; `receipt.title` is only the server's English fallback.
    const kindTitle = t(`agentSignal.receipts.${receipt.kind}.title`, receipt.title);
    const kindDetail = t(`agentSignal.receipts.${receipt.kind}.detail`, receipt.detail);
    const title = target?.title ?? kindTitle;
    // A memory reads as its own title + content summary; a skill keeps its kind label beneath.
    const description =
      receipt.kind === 'memory'
        ? (target?.summary ?? kindDetail)
        : target?.title
          ? kindTitle
          : kindDetail;
    const tooltip = `${kindTitle}: ${target?.summary ?? kindDetail}`;
    const documentId = target?.type === 'skill' ? (target.documentId ?? target.id) : undefined;
    const agentDocumentId =
      target?.type === 'skill' && typeof target.agentDocumentId === 'string'
        ? target.agentDocumentId
        : undefined;
    const memoryOpenTarget = getMemoryOpenTarget(target);
    const canOpen = Boolean(memoryOpenTarget) || Boolean(documentId);
    const rollbackDocumentId = receipt.metadata?.documentId;
    const rollbackHistoryId = receipt.metadata?.historyId;
    const rollbackAgentDocumentId = receipt.metadata?.agentDocumentId;
    const effectiveRollbackStatus = rollbackStatus ?? receipt.metadata?.rollbackStatus;
    const isMemoryUndo =
      receipt.kind === 'memory' &&
      target?.type === 'memory' &&
      target.operation === 'create' &&
      Boolean(target.id);
    const hasRollbackTarget =
      isMemoryUndo || (Boolean(rollbackDocumentId) && Boolean(rollbackHistoryId));
    const canRollback = hasRollbackTarget && effectiveRollbackStatus === 'available';
    const handleOpen = useCallback(() => {
      if (memoryOpenTarget?.type === 'portal') {
        openMemoryDetail({ id: memoryOpenTarget.id, layer: memoryOpenTarget.layer });
        return;
      }
      if (memoryOpenTarget?.type === 'route') {
        navigate(memoryOpenTarget.path);
        return;
      }

      if (target?.type !== 'skill') return;
      if (!documentId) return;

      openDocument(documentId, agentDocumentId);
    }, [
      agentDocumentId,
      documentId,
      memoryOpenTarget,
      navigate,
      openDocument,
      openMemoryDetail,
      target,
    ]);
    const handleRollback = useCallback(async () => {
      if (!canRollback || rollbackInFlightRef.current) return;

      rollbackInFlightRef.current = true;
      onRollbackStatusChange(receipt.id, 'pending');
      try {
        const result = await agentSignalService.rollbackReceipt({
          ...(rollbackAgentDocumentId ? { agentDocumentId: rollbackAgentDocumentId } : {}),
          ...(rollbackDocumentId ? { documentId: rollbackDocumentId } : {}),
          ...(rollbackHistoryId ? { historyId: rollbackHistoryId } : {}),
          receiptId: receipt.id,
        });
        const status = normalizeRollbackStatus(result.status);

        onRollbackStatusChange(receipt.id, status);

        if (ROLLBACK_SUCCESS_STATUSES.has(status)) {
          // Drop the cached detail so an open Portal / memory page shows the memory is gone.
          if (target?.type === 'memory' && target.memoryLayer && target.id) {
            void mutate(userMemoryKeys.memoryDetail(target.memoryLayer, target.id));
          }
          return;
        }

        if (status === 'failed') {
          toast.error(
            result.reason
              ? t('agentSignal.receipts.revert.error.failed', {
                  defaultValue: 'Undo failed: {{reason}}',
                  reason: result.reason,
                })
              : t(
                  'agentSignal.receipts.revert.error.generic',
                  'Undo failed. Please try again later',
                ),
          );
          return;
        }

        toast.error(
          t(
            `agentSignal.receipts.revert.error.${status as keyof typeof RECEIPT_ROLLBACK_ERROR_FALLBACK}`,
            RECEIPT_ROLLBACK_ERROR_FALLBACK[status as keyof typeof RECEIPT_ROLLBACK_ERROR_FALLBACK],
          ),
        );
      } catch (error) {
        onRollbackStatusChange(receipt.id, 'failed');
        const reason = error instanceof Error ? error.message : undefined;
        toast.error(
          reason
            ? t('agentSignal.receipts.revert.error.failed', {
                defaultValue: 'Undo failed: {{reason}}',
                reason,
              })
            : t('agentSignal.receipts.revert.error.generic', 'Undo failed. Please try again later'),
        );
      } finally {
        rollbackInFlightRef.current = false;
      }
    }, [
      canRollback,
      onRollbackStatusChange,
      receipt.id,
      rollbackAgentDocumentId,
      rollbackDocumentId,
      rollbackHistoryId,
      t,
      target,
    ]);
    const shouldShowRollbackStatus =
      effectiveRollbackStatus === 'available' ? canRollback : Boolean(effectiveRollbackStatus);
    const rollbackLabel =
      shouldShowRollbackStatus && effectiveRollbackStatus
        ? t(
            getRollbackStatusLabelKey(effectiveRollbackStatus, receipt.kind),
            receipt.kind === 'memory' && ROLLBACK_SUCCESS_STATUSES.has(effectiveRollbackStatus)
              ? 'Undone'
              : RECEIPT_ROLLBACK_LABEL_BY_STATUS[effectiveRollbackStatus],
          )
        : undefined;

    return (
      <PortalResourceCard
        description={description}
        icon={iconNode}
        openLabel={canOpen ? t('common:cmdk.toOpen', 'Open') : undefined}
        secondaryActionLabel={rollbackLabel}
        title={title}
        tooltip={tooltip}
        onOpen={canOpen ? handleOpen : undefined}
        onSecondaryAction={canRollback ? handleRollback : undefined}
      />
    );
  },
);

AgentSignalReceiptItem.displayName = 'AgentSignalReceiptItem';

const AgentSignalReceiptList = memo<AgentSignalReceiptListProps>(({ receipts }) => {
  const [rollbackStatuses, setRollbackStatuses] = useState<Record<string, ReceiptRollbackStatus>>(
    {},
  );
  const handleRollbackStatusChange = useCallback(
    (receiptId: string, status: ReceiptRollbackStatus) => {
      setRollbackStatuses((current) => ({ ...current, [receiptId]: status }));
    },
    [],
  );

  if (receipts.length === 0) return null;

  // TODO: Migrate this temporary receipt UI into the final Agent Signal feedback surface.
  return (
    <div className={styles.list}>
      {receipts.map((receipt) => (
        <AgentSignalReceiptItem
          key={receipt.id}
          receipt={receipt}
          rollbackStatus={rollbackStatuses[receipt.id]}
          onRollbackStatusChange={handleRollbackStatusChange}
        />
      ))}
    </div>
  );
});

AgentSignalReceiptList.displayName = 'AgentSignalReceiptList';

export default AgentSignalReceiptList;
