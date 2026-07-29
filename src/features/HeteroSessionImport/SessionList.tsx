import type { HeteroSessionDigest } from '@lobechat/types';
import { ClaudeCode, Codex } from '@lobehub/icons';
import { Flexbox, Icon, NeuralNetworkLoading, Tag, Text, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Checkbox } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import dayjs from 'dayjs';
import { Check, RotateCcw, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { baseName, fmtTokens, type ImportRowState, selectable, type SessionStatus } from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  row: css`
    padding-block: 10px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  rowDim: css`
    opacity: 0.45;
  `,
}));

const BRAND = { 'claude-code': ClaudeCode, 'codex': Codex } as const;

const StatusTag = memo<{ status: SessionStatus }>(({ status }) => {
  const { t } = useTranslation('topic');
  switch (status) {
    case 'syncable': {
      return (
        <Tooltip title={t('heteroImport.badge.syncableTip')}>
          <Tag color="blue" size="small">
            {t('heteroImport.badge.syncable')}
          </Tag>
        </Tooltip>
      );
    }
    case 'imported': {
      return <Tag size="small">{t('heteroImport.badge.imported')}</Tag>;
    }
    case 'linked': {
      return (
        <Tooltip title={t('heteroImport.badge.linkedTip')}>
          <Tag size="small">{t('heteroImport.badge.linked')}</Tag>
        </Tooltip>
      );
    }
    default: {
      return null;
    }
  }
});

const ImportState = memo<{ onRetry: () => void; showRetry: boolean; state?: ImportRowState }>(
  ({ state, showRetry, onRetry }) => {
    const { t } = useTranslation('topic');
    if (!state || state === 'pending')
      return (
        <Text fontSize={12} type="secondary">
          {t('heteroImport.state.pending')}
        </Text>
      );
    if (state === 'running')
      return (
        <Flexbox horizontal align="center" gap={6}>
          <NeuralNetworkLoading size={14} />
          <Text fontSize={12} type="secondary">
            {t('heteroImport.state.running')}
          </Text>
        </Flexbox>
      );
    if (state.ok)
      return (
        <Flexbox horizontal align="center" gap={4}>
          <Icon icon={Check} size={14} style={{ color: 'var(--lobe-color-success, #52c41a)' }} />
          <Text fontSize={12} type="success">
            {t('heteroImport.state.inserted', { count: state.inserted })}
          </Text>
        </Flexbox>
      );
    if (showRetry)
      return (
        <Button icon={<Icon icon={RotateCcw} size={13} />} size="small" onClick={onRetry}>
          {t('heteroImport.retry')}
        </Button>
      );
    return (
      <Flexbox horizontal align="center" gap={4}>
        <Icon icon={X} size={14} style={{ color: 'var(--lobe-color-error, #ff4d4f)' }} />
        <Text fontSize={12} type="danger">
          {t('heteroImport.state.failed')}
        </Text>
      </Flexbox>
    );
  },
);

export interface SessionListItem {
  digest: HeteroSessionDigest;
  status: SessionStatus;
}

interface SessionRowProps {
  checked: boolean;
  importing: boolean;
  importState?: ImportRowState;
  item: SessionListItem;
  onRetry: (sessionId: string) => void;
  onToggle: (sessionId: string) => void;
  showDir: boolean;
  showRetry: boolean;
}

export const SessionRow = memo<SessionRowProps>(
  ({ item, checked, importing, importState, onRetry, onToggle, showDir, showRetry }) => {
    const { t } = useTranslation('topic');
    const { digest, status } = item;
    const canPick = selectable(status) && !importing;
    const dim = !selectable(status);
    const Brand = BRAND[digest.source];

    return (
      <Flexbox
        horizontal
        align="center"
        className={cx(styles.row, dim && styles.rowDim)}
        data-session-row={digest.sessionId}
        gap={12}
        style={{ cursor: canPick ? 'pointer' : 'default' }}
        onClick={() => canPick && onToggle(digest.sessionId)}
      >
        {!importing && (
          <Checkbox
            checked={checked}
            disabled={!selectable(status)}
            onChange={() => onToggle(digest.sessionId)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={8}>
            {showDir && <Brand size={13} style={{ flex: 'none', opacity: 0.75 }} />}
            <Text ellipsis>{digest.title || digest.firstPrompt || digest.sessionId}</Text>
            <StatusTag status={status} />
          </Flexbox>
          <Flexbox horizontal align="center" gap={10}>
            {digest.endAt && (
              <Text fontSize={12} type="secondary">
                {dayjs(digest.endAt).format('MM-DD HH:mm')}
              </Text>
            )}
            <Text fontSize={12} type="secondary">
              {t('heteroImport.meta.messages', { count: digest.messageCount })}
            </Text>
            {digest.tokens ? (
              <Text fontSize={12} type="secondary">
                {t('heteroImport.meta.tokens', { tokens: fmtTokens(digest.tokens) })}
              </Text>
            ) : null}
            {digest.gitBranch && (
              <Text ellipsis fontSize={12} type="secondary">
                {digest.gitBranch}
              </Text>
            )}
            {showDir && (
              <Text fontSize={12} type="secondary">
                {baseName(digest.workingDirectory ?? '')}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        {importing && (
          <ImportState
            showRetry={showRetry}
            state={importState}
            onRetry={() => onRetry(digest.sessionId)}
          />
        )}
      </Flexbox>
    );
  },
);
