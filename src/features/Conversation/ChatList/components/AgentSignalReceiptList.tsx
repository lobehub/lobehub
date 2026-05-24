'use client';

import { LayersEnum } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { Brain, ClipboardCheck } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PortalResourceCard from '@/features/Conversation/components/PortalResourceCard';
import { useStableNavigate } from '@/hooks/useStableNavigate';
import { useChatStore } from '@/store/chat';

import type { AgentSignalReceiptView } from '../hooks/useAgentSignalReceipts';

const PAGE_ROUTE_PATTERN = /^\/agent\/([^/]+)\/([^/]+)\/page(?:\/[^/?#]+)?/;
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

const renderReceiptIcon = (kind: AgentSignalReceiptView['kind']) => {
  if (kind === 'skill') return <SkillsIcon size={28} />;
  const LucideIconComponent = RECEIPT_LUCIDE_ICON_BY_KIND[kind];
  return LucideIconComponent ? <Icon icon={LucideIconComponent} size={28} /> : null;
};

interface AgentSignalReceiptListProps {
  receipts: AgentSignalReceiptView[];
}

interface AgentSignalReceiptItemProps {
  receipt: AgentSignalReceiptView;
}

const getMemoryRoute = (target?: AgentSignalReceiptView['target']) => {
  if (target?.type !== 'memory') return;

  if (!target.memoryLayer) return '/memory';

  const route = MEMORY_ROUTE_BY_LAYER[target.memoryLayer];
  if (!route) return '/memory';

  return target.id ? `${route.path}?${route.idParam}=${encodeURIComponent(target.id)}` : route.path;
};

const AgentSignalReceiptItem = memo<AgentSignalReceiptItemProps>(({ receipt }) => {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useStableNavigate();
  const openDocument = useChatStore((s) => s.openDocument);
  const iconNode = renderReceiptIcon(receipt.kind);
  const fallbackTitle = t(`agentSignal.receipts.${receipt.kind}.title`, receipt.title);
  const detail = t(`agentSignal.receipts.${receipt.kind}.detail`, receipt.detail);
  const title = receipt.target?.title ?? fallbackTitle;
  const description = receipt.target ? fallbackTitle : detail;
  const summary = receipt.target?.summary ?? detail;
  const tooltip = `${fallbackTitle}: ${summary}`;
  const target = receipt.target;
  const documentId = target?.type === 'skill' ? (target.documentId ?? target.id) : undefined;
  const memoryRoute = getMemoryRoute(target);
  const canOpen = Boolean(memoryRoute) || Boolean(documentId);
  const handleOpen = useCallback(() => {
    if (memoryRoute) {
      navigate(memoryRoute);
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
  }, [documentId, memoryRoute, navigate, openDocument, target]);

  return (
    <PortalResourceCard
      description={description}
      icon={iconNode}
      openLabel={canOpen ? t('common:cmdk.toOpen', 'Open') : undefined}
      title={title}
      tooltip={tooltip}
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
