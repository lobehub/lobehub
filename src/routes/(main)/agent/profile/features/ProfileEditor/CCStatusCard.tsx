'use client';

import { isDesktop } from '@lobechat/const';
import { type ClaudeAuthStatus, type ToolStatus } from '@lobechat/electron-client-ipc';
import { ActionIcon, CopyButton, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { CheckCircle2, Loader2Icon, RefreshCw, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toolDetectorService } from '@/services/electron/toolDetector';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillQuaternary};
  `,
  label: css`
    min-width: 72px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  path: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
}));

const CCStatusCard = memo(() => {
  const { t } = useTranslation('setting');
  const { styles } = useStyles();
  const [status, setStatus] = useState<ToolStatus | undefined>();
  const [auth, setAuth] = useState<ClaudeAuthStatus | null>(null);
  const [detecting, setDetecting] = useState(true);

  // Fetched independently of `detectTool`: an auth-fetch failure must not
  // flip the CLI status card to unavailable.
  const fetchAuth = useCallback(async () => {
    try {
      const result = await toolDetectorService.getClaudeAuthStatus();
      setAuth(result);
    } catch (error) {
      console.warn('[CCStatusCard] Failed to get claude auth status:', error);
      setAuth(null);
    }
  }, []);

  const detect = useCallback(async () => {
    if (!isDesktop) return;
    setDetecting(true);
    try {
      const result = await toolDetectorService.detectTool('claude', true);
      setStatus(result);
    } catch (error) {
      console.error('[CCStatusCard] Failed to detect claude CLI:', error);
      setStatus({ available: false, error: (error as Error).message });
    } finally {
      setDetecting(false);
    }
    void fetchAuth();
  }, [fetchAuth]);

  useEffect(() => {
    void detect();
  }, [detect]);

  const renderBody = () => {
    if (detecting) {
      return (
        <Flexbox horizontal align="center" gap={8}>
          <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.6 }} />
          <Text type="secondary">{t('ccStatus.detecting')}</Text>
        </Flexbox>
      );
    }

    if (!status || !status.available) {
      return (
        <Flexbox horizontal align="center" gap={8}>
          <Icon color="var(--ant-color-error)" icon={XCircle} size={16} />
          <Text type="secondary">{t('ccStatus.unavailable')}</Text>
        </Flexbox>
      );
    }

    return (
      <Flexbox horizontal align="center" gap={8} style={{ flex: 1, minWidth: 0 }}>
        <Icon color="var(--ant-color-success)" icon={CheckCircle2} size={16} />
        {status.version && <Tag color="processing">{status.version}</Tag>}
        {status.path && (
          <Tooltip title={status.path}>
            <Flexbox
              horizontal
              align="center"
              gap={4}
              style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
            >
              <Text ellipsis className={styles.path}>
                {status.path}
              </Text>
              <CopyButton content={status.path} size="small" />
            </Flexbox>
          </Tooltip>
        )}
      </Flexbox>
    );
  };

  const renderAuth = () => {
    if (detecting || !status?.available || !auth?.loggedIn) return null;

    return (
      <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
        <Text className={styles.label}>{t('ccStatus.account.label')}</Text>
        {auth.email && <Text ellipsis>{auth.email}</Text>}
        {auth.subscriptionType && (
          <Tag color="gold" style={{ marginInlineEnd: 0 }}>
            {auth.subscriptionType.toUpperCase()}
          </Tag>
        )}
      </Flexbox>
    );
  };

  return (
    <Flexbox className={styles.card} gap={8} style={{ marginBottom: 12 }}>
      <Flexbox horizontal align="center" gap={8} justify="space-between">
        <Text strong>{t('ccStatus.title')}</Text>
        <Tooltip title={t('ccStatus.redetect')}>
          <ActionIcon
            disabled={detecting}
            icon={RefreshCw}
            loading={detecting}
            size="small"
            onClick={detect}
          />
        </Tooltip>
      </Flexbox>
      {renderBody()}
      {renderAuth()}
    </Flexbox>
  );
});

CCStatusCard.displayName = 'CCStatusCard';

export default CCStatusCard;
