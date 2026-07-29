'use client';

import { InfoCircleOutlined } from '@ant-design/icons';
import { Alert, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { App, QRCode } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ExternalLinkIcon, QrCodeIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { messengerService } from '@/services/messenger';

import { getMessengerErrorMessage } from '../i18n';
import {
  DetailLayout,
  IntegrationDetailSkeleton,
  useLinkActions,
  useMessengerData,
  UserAgentConnection,
} from './shared';
import WechatPushSection from './WechatPush';

const QR_POLL_INTERVAL_MS = 2000;
const QR_SIZE = 220;
const QR_SLOT_SIZE = 240;

const styles = createStaticStyles(({ css, cssVar }) => ({
  error: css`
    align-items: center;
    width: 100%;
  `,
  qrSlot: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: ${QR_SLOT_SIZE}px;
    height: ${QR_SLOT_SIZE}px;
    padding: 9px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  setup: css`
    align-items: center;

    padding-block: 32px;
    padding-inline: 20px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
  `,
  status: css`
    min-height: 20px;
    font-size: ${cssVar.fontSize};
    text-align: center;
  `,
  tips: css`
    max-width: 480px;
    font-size: ${cssVar.fontSize};
    text-align: center;
  `,
}));

type QrState =
  | { stage: 'idle' }
  | { stage: 'loading' }
  | { message: string; stage: 'error' }
  | { qrCodePayload: string; stage: 'ready'; status: 'scaned' | 'wait' };

interface WechatQrSetupProps {
  autoStart?: boolean;
  disabled?: boolean;
  onCancel?: () => void;
  onConfirmed: () => Promise<void>;
}

const WechatQrSetup = memo<WechatQrSetupProps>(({ autoStart, disabled, onCancel, onConfirmed }) => {
  const { t } = useTranslation('messenger');
  const [state, setState] = useState<QrState>({ stage: 'idle' });
  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (disabled) return;
    stopPolling();
    setState({ stage: 'loading' });

    try {
      const session = await messengerService.createWechatQrSession();
      if (!aliveRef.current) return;
      setState({ qrCodePayload: session.qrCodePayload, stage: 'ready', status: 'wait' });

      const poll = async (): Promise<void> => {
        if (!aliveRef.current) return;
        try {
          const result = await messengerService.pollWechatQrSession(session.sessionId);
          if (!aliveRef.current) return;

          if (result.status === 'confirmed') {
            stopPolling();
            await onConfirmed();
            return;
          }
          if (result.status === 'expired') {
            stopPolling();
            setState({ message: t('messenger.wechat.qr.expired'), stage: 'error' });
            return;
          }

          setState({
            qrCodePayload: session.qrCodePayload,
            stage: 'ready',
            status: result.status,
          });
          timerRef.current = setTimeout(poll, QR_POLL_INTERVAL_MS);
        } catch (error) {
          stopPolling();
          setState({
            message: getMessengerErrorMessage(error, t, 'messenger.wechat.error.pollFailed'),
            stage: 'error',
          });
        }
      };

      timerRef.current = setTimeout(poll, QR_POLL_INTERVAL_MS);
    } catch (error) {
      setState({
        message: getMessengerErrorMessage(error, t, 'messenger.wechat.error.qrUnavailable'),
        stage: 'error',
      });
    }
  }, [disabled, onConfirmed, stopPolling, t]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  useEffect(() => {
    if (!autoStart || startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [autoStart, start]);

  const status =
    state.stage === 'ready'
      ? state.status === 'scaned'
        ? t('messenger.wechat.qr.scanned')
        : t('messenger.wechat.qr.waiting')
      : undefined;

  return (
    <Block className={styles.setup}>
      <Flexbox align="center" gap={12}>
        <div className={styles.qrSlot}>
          {state.stage === 'idle' && (
            <Button
              disabled={disabled}
              icon={<Icon icon={QrCodeIcon} />}
              type="primary"
              onClick={start}
            >
              {t('messenger.wechat.connectCta')}
            </Button>
          )}
          {state.stage === 'loading' && <NeuralNetworkLoading size={48} />}
          {state.stage === 'ready' && (
            <QRCode
              aria-label={t('messenger.wechat.setupTitle')}
              bgColor="#fff"
              bordered={false}
              color="#000"
              size={QR_SIZE}
              value={state.qrCodePayload}
            />
          )}
          {state.stage === 'error' && (
            <Flexbox className={styles.error} gap={12}>
              <Alert showIcon message={state.message} type="warning" />
              <Button
                disabled={disabled}
                icon={<Icon icon={RefreshCwIcon} />}
                type="primary"
                onClick={start}
              >
                {t('messenger.wechat.retry')}
              </Button>
            </Flexbox>
          )}
        </div>

        {state.stage === 'ready' && (
          <Text className={styles.status} type="secondary">
            {status}
          </Text>
        )}

        <Text className={styles.tips} type="secondary">
          <InfoCircleOutlined style={{ marginInlineEnd: 4 }} />
          {t('messenger.wechat.qr.tip')}
        </Text>

        {onCancel && state.stage !== 'idle' && (
          <Button icon={<Icon icon={XIcon} />} type="text" onClick={onCancel}>
            {t('messenger.wechat.cancelRescan')}
          </Button>
        )}
      </Flexbox>
    </Block>
  );
});
WechatQrSetup.displayName = 'MessengerWechatQrSetup';

export { WechatQrSetup };

interface WechatDetailProps {
  access?: {
    allowed?: boolean;
    blockedMessage?: string;
    requiredPlan?: 'paid';
  };
  name: string;
  onBack: () => void;
}

const WechatDetail = memo<WechatDetailProps>(({ access, name, onBack }) => {
  const { t } = useTranslation('messenger');
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [rescanning, setRescanning] = useState(false);
  const data = useMessengerData('wechat');
  const { handleSetActive, handleUnlink } = useLinkActions({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
    name,
    platform: 'wechat',
  });

  if (data.error && data.isInitialLoading)
    return <AsyncError error={data.error} variant="block" onRetry={data.mutate} />;
  if (data.isInitialLoading) return <IntegrationDetailSkeleton withNestedContent />;

  const link = data.links[0];
  const installation = data.installations[0];
  const hasConnection = !!link && !!installation;
  const paidBlocked = access?.requiredPlan === 'paid' && access.allowed === false;
  const runtimeFailed = installation?.runtime?.status === 'failed';
  const sessionExpired = installation?.runtime?.errorCode === 'session_expired';

  const handleConfirmed = async () => {
    await Promise.all([data.linksMutate(), data.installationsMutate()]);
    setRescanning(false);
    message.success(t('messenger.wechat.connected'));
  };

  const headerAction =
    hasConnection && !paidBlocked ? (
      <Button
        disabled={!canCreate || !canEdit}
        icon={<Icon icon={RefreshCwIcon} />}
        onClick={() => setRescanning(true)}
      >
        {t('messenger.wechat.rescan')}
      </Button>
    ) : null;

  return (
    <DetailLayout
      hasConnections
      extraSections={!paidBlocked && hasConnection ? <WechatPushSection /> : undefined}
      headerAction={headerAction}
      name={name}
      platform="wechat"
      sectionTitle={
        hasConnection ? t('messenger.detail.connections.title') : t('messenger.wechat.setupTitle')
      }
      onBack={onBack}
    >
      {paidBlocked ? (
        <>
          <Alert
            showIcon
            description={t('messenger.wechat.paidDescription')}
            type="info"
            message={
              <Flexbox horizontal align="center" gap={12} justify="space-between">
                <span>{t('messenger.wechat.paidTitle')}</span>
                <Button
                  icon={<Icon icon={ExternalLinkIcon} />}
                  size="small"
                  type="primary"
                  onClick={() => navigate('/settings/plans')}
                >
                  {t('messenger.wechat.upgradeCta')}
                </Button>
              </Flexbox>
            }
          />
          {link && (
            <UserAgentConnection
              extraLabel={t('messenger.wechat.accountLabel')}
              link={link}
              onSetActive={(agentId) => handleSetActive(link.tenantId, agentId)}
              onUnlink={() => handleUnlink(link.tenantId)}
            />
          )}
        </>
      ) : (
        <>
          {(!hasConnection || rescanning) && (
            <WechatQrSetup
              autoStart={hasConnection && rescanning}
              disabled={!canCreate || !canEdit}
              onCancel={hasConnection ? () => setRescanning(false) : undefined}
              onConfirmed={handleConfirmed}
            />
          )}

          {runtimeFailed && hasConnection && (
            <Alert
              showIcon
              type="warning"
              description={
                sessionExpired
                  ? t('messenger.wechat.runtime.sessionExpiredDescription')
                  : t('messenger.wechat.runtime.failedDescription')
              }
              message={
                sessionExpired
                  ? t('messenger.wechat.runtime.sessionExpiredTitle')
                  : t('messenger.wechat.runtime.failedTitle')
              }
            />
          )}

          {link && !link.activeAgentId && (
            <Alert showIcon message={t('messenger.wechat.selectAgentHint')} type="info" />
          )}

          {link && (
            <UserAgentConnection
              extraLabel={t('messenger.wechat.accountLabel')}
              link={link}
              onSetActive={(agentId) => handleSetActive(link.tenantId, agentId)}
              onUnlink={() => handleUnlink(link.tenantId)}
            />
          )}
        </>
      )}
    </DetailLayout>
  );
});

WechatDetail.displayName = 'MessengerWechatDetail';

export default WechatDetail;
