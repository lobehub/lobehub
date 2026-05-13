'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { Brain, ClipboardCheck, FileText, RadioTower } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PortalResourceCard from '@/features/Conversation/components/PortalResourceCard';
import { useStableNavigate } from '@/hooks/useStableNavigate';
import { useChatStore } from '@/store/chat';

import type { AgentSignalReceiptView } from '../hooks/useAgentSignalReceipts';

const PAGE_ROUTE_PATTERN = /^\/agent\/([^/]+)\/([^/]+)\/page(?:\/[^/?#]+)?/;

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentSignalDescription: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    max-width: 100%;
  `,
  agentSignalMarker: css`
    display: inline-flex;
    flex: none;
    align-items: center;
    color: ${cssVar.colorPrimary};
  `,
  descriptionText: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    width: 100%;
    margin-block-start: 8px;
  `,
}));

const RECEIPT_ICON_BY_KIND = {
  memory: Brain,
  review: ClipboardCheck,
  skill: FileText,
} satisfies Record<AgentSignalReceiptView['kind'], LucideIcon>;

interface AgentSignalReceiptListProps {
  receipts: AgentSignalReceiptView[];
}

interface AgentSignalReceiptItemProps {
  receipt: AgentSignalReceiptView;
}

const AgentSignalReceiptItem = memo<AgentSignalReceiptItemProps>(({ receipt }) => {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useStableNavigate();
  const openDocument = useChatStore((s) => s.openDocument);
  const ReceiptIcon = RECEIPT_ICON_BY_KIND[receipt.kind];
  const fallbackTitle = t(`agentSignal.receipts.${receipt.kind}.title`, receipt.title);
  const detail = t(`agentSignal.receipts.${receipt.kind}.detail`, receipt.detail);
  const title = receipt.target?.title ?? fallbackTitle;
  const description = receipt.target ? fallbackTitle : detail;
  const summary = receipt.target?.summary ?? detail;
  const tooltip = `${fallbackTitle}: ${summary}`;
  const agentSignalLabel = t('agentSignal.receipts.agentSignalLabel', 'Agent Signal');
  const descriptionRender = (
    <span className={styles.agentSignalDescription}>
      <span
        aria-label={agentSignalLabel}
        className={styles.agentSignalMarker}
        title={agentSignalLabel}
      >
        <Icon icon={RadioTower} size={12} />
      </span>
      <span className={styles.descriptionText}>{description}</span>
    </span>
  );
  const target = receipt.target;
  const documentId = target?.type === 'skill' ? (target.documentId ?? target.id) : undefined;
  const canOpen = target?.type === 'memory' || Boolean(documentId);
  const handleOpen = useCallback(() => {
    if (target?.type === 'memory') {
      navigate('/memory');
      return;
    }

    if (target?.type !== 'skill') return;
    if (!documentId) return;

    const pathname = globalThis.location?.pathname ?? '';
    const pageMatch = PAGE_ROUTE_PATTERN.exec(pathname);

    if (pageMatch?.[1] && pageMatch[2]) {
      navigate(`/agent/${pageMatch[1]}/${pageMatch[2]}/page/${documentId}`);
      return;
    }

    openDocument(documentId);
  }, [documentId, navigate, openDocument, target]);

  return (
    <PortalResourceCard
      description={descriptionRender}
      icon={ReceiptIcon}
      openLabel={canOpen ? t('common:cmdk.toOpen', 'Open') : undefined}
      title={title}
      tooltip={tooltip}
      // TODO: Replace memory fallback with category/id-aware routes when Agent Signal receipts expose them.
      onOpen={canOpen ? handleOpen : undefined}
    />
  );
});

AgentSignalReceiptItem.displayName = 'AgentSignalReceiptItem';

const AgentSignalReceiptList = memo<AgentSignalReceiptListProps>(({ receipts }) => {
  if (receipts.length === 0) return null;

  // TODO: Migrate this temporary receipt UI into the final Agent Signal feedback surface.
  return (
    <div className={styles.list}>
      {receipts.map((receipt) => (
        <AgentSignalReceiptItem key={receipt.id} receipt={receipt} />
      ))}
    </div>
  );
});

AgentSignalReceiptList.displayName = 'AgentSignalReceiptList';

export default AgentSignalReceiptList;
