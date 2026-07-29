'use client';

import { LayersEnum } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { Brain, ClipboardCheck } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PortalResourceCard from '@/features/Conversation/components/PortalResourceCard';
import { useStableNavigate } from '@/hooks/useStableNavigate';
import { agentSignalService } from '@/services/agentSignal';
import { useChatStore } from '@/store/chat';

import type { AgentSignalReceiptView } from '../hooks/useAgentSignalReceipts';

const MEMORY_ROUTE_BY_LAYER = {
  [LayersEnum.Activity]: { idParam: 'activityId', path: '/memory/activities' },
  [LayersEnum.Context]: { idParam: 'contextId', path: '/memory/contexts' },
  [LayersEnum.Experience]: { idParam: 'experienceId', path: '/memory/experiences' },
  [LayersEnum.Identity]: { idParam: 'identityId', path: '/memory/identities' },
  [LayersEnum.Preference]: { idParam: 'preferenceId', path: '/memory/preferences' },
} satisfies Record<LayersEnum, { idParam: string; path: string }>;

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

const getMemoryRoute = (target?: AgentSignalReceiptView['target']) => {
  if (target?.type !== 'memory') return;

  const hasLayerMetadata = Boolean(target.memoryLayer);
  const memoryLayer =
    target.memoryLayer ??
    (LEGACY_PREFERENCE_MEMORY_PATTERN.test(`${target.title} ${target.summary ?? ''}`)
      ? LayersEnum.Preference
      : undefined);

  if (!memoryLayer) return '/memory';

  const route = MEMORY_ROUTE_BY_LAYER[memoryLayer];
  if (!route) return '/memory';

  const layerSpecificId = hasLayerMetadata ? target.id : undefined;

  return layerSpecificId
    ? `${route.path}?${route.idParam}=${encodeURIComponent(layerSpecificId)}`
    : route.path;
};

const getRollbackStatusLabelKey = (status: ReceiptRollbackStatus) => {
  if (status === 'available') return 'agentSignal.receipts.revert.undo';
  if (status === 'already_rolled_back') return 'agentSignal.receipts.revert.rolled_back';

  return `agentSignal.receipts.revert.${status}`;
};

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
    const rollbackInFlightRef = useRef(false);
    const iconNode = renderReceiptIcon(receipt.kind);
    const fallbackTitle = t(`agentSignal.receipts.${receipt.kind}.title`, receipt.title);
    const detail = t(`agentSignal.receipts.${receipt.kind}.detail`, receipt.detail);
    const title = receipt.target?.title ?? fallbackTitle;
    const description = receipt.target ? fallbackTitle : detail;
    const summary = receipt.target?.summary ?? detail;
    const tooltip = `${fallbackTitle}: ${summary}`;
    const target = receipt.target;
    const documentId = target?.type === 'skill' ? (target.documentId ?? target.id) : undefined;
    const agentDocumentId =
      target?.type === 'skill' && typeof target.agentDocumentId === 'string'
        ? target.agentDocumentId
        : undefined;
    const memoryRoute = getMemoryRoute(target);
    const canOpen = Boolean(memoryRoute) || Boolean(documentId);
    const rollbackDocumentId = receipt.metadata?.documentId;
    const rollbackHistoryId = receipt.metadata?.historyId;
    const rollbackAgentDocumentId = receipt.metadata?.agentDocumentId;
    const effectiveRollbackStatus = rollbackStatus ?? receipt.metadata?.rollbackStatus;
    const canRollback =
      Boolean(rollbackDocumentId) &&
      Boolean(rollbackHistoryId) &&
      effectiveRollbackStatus === 'available';
    const handleOpen = useCallback(() => {
      if (memoryRoute) {
        navigate(memoryRoute);
        return;
      }

      if (target?.type !== 'skill') return;
      if (!documentId) return;

      openDocument(documentId, agentDocumentId);
    }, [agentDocumentId, documentId, memoryRoute, navigate, openDocument, target]);
    const handleRollback = useCallback(async () => {
      if (!rollbackDocumentId || !rollbackHistoryId || rollbackInFlightRef.current) return;

      rollbackInFlightRef.current = true;
      onRollbackStatusChange(receipt.id, 'pending');
      try {
        const result = await agentSignalService.rollbackReceipt({
          ...(rollbackAgentDocumentId ? { agentDocumentId: rollbackAgentDocumentId } : {}),
          documentId: rollbackDocumentId,
          historyId: rollbackHistoryId,
          receiptId: receipt.id,
        });
        onRollbackStatusChange(receipt.id, normalizeRollbackStatus(result.status));
      } catch {
        onRollbackStatusChange(receipt.id, 'failed');
      } finally {
        rollbackInFlightRef.current = false;
      }
    }, [
      onRollbackStatusChange,
      receipt.id,
      rollbackAgentDocumentId,
      rollbackDocumentId,
      rollbackHistoryId,
    ]);
    const shouldShowRollbackStatus =
      effectiveRollbackStatus === 'available' ? canRollback : Boolean(effectiveRollbackStatus);
    const rollbackLabel =
      shouldShowRollbackStatus && effectiveRollbackStatus
        ? t(
            getRollbackStatusLabelKey(effectiveRollbackStatus),
            RECEIPT_ROLLBACK_LABEL_BY_STATUS[effectiveRollbackStatus],
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
