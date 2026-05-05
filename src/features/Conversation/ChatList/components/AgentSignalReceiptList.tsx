'use client';

import { Block, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Activity, CheckCircle, ChevronRight, Sparkles } from 'lucide-react';
import { AnimatePresence, m as motion } from 'motion/react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStableNavigate } from '@/hooks/useStableNavigate';
import { useChatStore } from '@/store/chat';

import type { AgentSignalReceiptView } from '../hooks/useAgentSignalReceipts';

const PAGE_ROUTE_PATTERN = /^\/agent\/([^/]+)\/([^/]+)\/page(?:\/[^/?#]+)?/;

const useStyles = createStyles(({ css, token }) => ({
  content: css`
    overflow: hidden;
  `,
  item: css`
    width: 100%;
    padding-block: 6px;
    padding-inline: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;

    font-size: 12px;
    line-height: 1.45;
    color: ${token.colorTextSecondary};

    background: ${token.colorFillQuaternary};
  `,
  itemButton: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    padding: 0;
    border: 0;

    color: inherit;
    text-align: start;

    background: transparent;
  `,
  label: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    width: fit-content;
    max-width: min(520px, 100%);
    margin-block-start: 4px;
    padding: 0;
    border: 0;

    font-size: 12px;
    line-height: 1.45;
    color: ${token.colorTextTertiary};

    background: transparent;
  `,
  labelText: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  labelIcon: css`
    transition: transform 120ms ease;
  `,
  labelIconOpen: css`
    transform: rotate(90deg);
  `,
  title: css`
    font-weight: 500;
    color: ${token.colorText};
  `,
  titleGroup: css`
    overflow: hidden;
    min-width: 0;
  `,
}));

const collapseTransition = {
  duration: 0.16,
  ease: [0.4, 0, 0.2, 1],
} as const;

interface AgentSignalReceiptListProps {
  receipts: AgentSignalReceiptView[];
  showRecentLabel?: boolean;
}

interface AgentSignalReceiptItemProps {
  receipt: AgentSignalReceiptView;
}

const AgentSignalReceiptItem = memo<AgentSignalReceiptItemProps>(({ receipt }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('chat');
  const navigate = useStableNavigate();
  const openDocument = useChatStore((s) => s.openDocument);
  const ReceiptIcon = receipt.kind === 'memory' ? CheckCircle : Sparkles;
  const fallbackTitle = t(`agentSignal.receipts.${receipt.kind}.title`, receipt.title);
  const title = receipt.target?.title ?? fallbackTitle;
  const detail = t(`agentSignal.receipts.${receipt.kind}.detail`, receipt.detail);
  const summary = receipt.target?.summary ?? detail;
  const tooltip = `${fallbackTitle}: ${summary}`;
  const target = receipt.target;
  const handleOpen = useCallback(() => {
    if (target?.type === 'memory') {
      navigate('/memory');
      return;
    }

    if (target?.type !== 'skill' || !target.id) return;

    const pathname = globalThis.location?.pathname ?? '';
    const pageMatch = PAGE_ROUTE_PATTERN.exec(pathname);

    if (pageMatch?.[1] && pageMatch[2]) {
      navigate(`/agent/${pageMatch[1]}/${pageMatch[2]}/page/${target.id}`);
      return;
    }

    openDocument(target.id);
  }, [navigate, openDocument, target]);

  return (
    <div className={styles.item}>
      <Tooltip placement={'topLeft'} title={tooltip}>
        <button
          className={styles.itemButton}
          type={'button'}
          // TODO: Replace memory fallback with category/id-aware routes when Agent Signal receipts expose them.
          onClick={handleOpen}
        >
          <Block
            horizontal
            align={'center'}
            flex={'none'}
            height={24}
            justify={'center'}
            style={{ fontSize: 12 }}
            variant={'outlined'}
            width={24}
          >
            <Icon icon={ReceiptIcon} />
          </Block>
          <Flexbox className={styles.titleGroup}>
            <span className={styles.title}>{title}</span>
            <span className={styles.labelText}>{fallbackTitle}</span>
          </Flexbox>
        </button>
      </Tooltip>
    </div>
  );
});

AgentSignalReceiptItem.displayName = 'AgentSignalReceiptItem';

const AgentSignalReceiptList = memo<AgentSignalReceiptListProps>(
  ({ receipts, showRecentLabel }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(true);

    if (receipts.length === 0) return null;

    // TODO: Migrate this temporary receipt UI into the final Agent Signal feedback surface.
    return (
      <Flexbox gap={4}>
        {showRecentLabel && (
          <button className={styles.label} type={'button'} onClick={() => setOpen(!open)}>
            <Block
              horizontal
              align={'center'}
              flex={'none'}
              height={24}
              justify={'center'}
              style={{ fontSize: 12 }}
              variant={'outlined'}
              width={24}
            >
              <Icon icon={Activity} />
            </Block>
            <span className={styles.labelText}>{t('agentSignal.receipts.recentActivity')}</span>
            <Icon className={open ? styles.labelIconOpen : styles.labelIcon} icon={ChevronRight} />
          </button>
        )}
        <AnimatePresence initial={false}>
          {(!showRecentLabel || open) && (
            <motion.div
              animate={{ height: 'auto', opacity: 1 }}
              className={styles.content}
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              transition={collapseTransition}
            >
              <Flexbox gap={4}>
                {receipts.map((receipt) => (
                  <AgentSignalReceiptItem key={receipt.id} receipt={receipt} />
                ))}
              </Flexbox>
            </motion.div>
          )}
        </AnimatePresence>
      </Flexbox>
    );
  },
);

AgentSignalReceiptList.displayName = 'AgentSignalReceiptList';

export default AgentSignalReceiptList;
