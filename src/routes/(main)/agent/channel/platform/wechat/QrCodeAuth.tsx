'use client';

import { InfoCircleOutlined } from '@ant-design/icons';
import { Alert, Flexbox, Text } from '@lobehub/ui';
import type { ButtonProps } from '@lobehub/ui/base-ui';
import { Button } from '@lobehub/ui/base-ui';
import { QRCode } from 'antd';
import { createStaticStyles } from 'antd-style';
import { QrCode, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { agentBotProviderService } from '@/services/agentBotProvider';

const QR_CODE_SIZE = 220;
const QR_POLL_INTERVAL_MS = 2000;
const QR_SLOT_SIZE = 240;

const styles = createStaticStyles(({ css, cssVar }) => ({
  auth: css`
    align-items: center;
    width: 100%;
  `,
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
  status: css`
    min-height: 20px;
    font-size: 13px;
    text-align: center;
  `,
  tips: css`
    max-width: 480px;
    font-size: 13px;
    text-align: center;
  `,
}));

interface WechatCredentials {
  botId: string;
  botToken: string;
  userId: string;
}

type QrAuthState =
  | { stage: 'idle' }
  | { stage: 'loading' }
  | { message: string; stage: 'error' }
  | { imageUrl: string; stage: 'ready'; status: string };

interface QrCodeAuthProps {
  buttonType?: ButtonProps['type'];
  disabled?: boolean;
  onAuthenticated: (credentials: WechatCredentials) => void;
  showTips?: boolean;
}

const QrCodeAuth = memo<QrCodeAuthProps>(
  ({ buttonType = 'primary', disabled, onAuthenticated, showTips = true }) => {
    const { t } = useTranslation('agent');
    const [state, setState] = useState<QrAuthState>({ stage: 'idle' });
    const pollingRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const stopPolling = useCallback(() => {
      pollingRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }, []);

    const startQrFlow = useCallback(async () => {
      if (disabled) return;

      setState({ stage: 'loading' });
      stopPolling();

      try {
        const qr = await agentBotProviderService.wechatGetQrCode();
        setState({ imageUrl: qr.qrcode_img_content, stage: 'ready', status: 'wait' });

        pollingRef.current = true;
        const poll = async () => {
          if (!pollingRef.current) return;

          try {
            const result = await agentBotProviderService.wechatPollQrStatus(qr.qrcode);
            if (!pollingRef.current) return;

            if (result.status === 'confirmed' && result.bot_token) {
              stopPolling();
              onAuthenticated({
                botId: result.ilink_bot_id || '',
                botToken: result.bot_token,
                userId: result.ilink_user_id || '',
              });
              return;
            }

            if (result.status === 'expired') {
              stopPolling();
              setState({ message: t('channel.wechatQrExpired'), stage: 'error' });
              return;
            }

            setState({
              imageUrl: qr.qrcode_img_content,
              stage: 'ready',
              status: result.status,
            });
            timerRef.current = setTimeout(poll, QR_POLL_INTERVAL_MS);
          } catch (error) {
            console.error(error);
            if (pollingRef.current) {
              timerRef.current = setTimeout(poll, QR_POLL_INTERVAL_MS);
            }
          }
        };

        timerRef.current = setTimeout(poll, QR_POLL_INTERVAL_MS);
      } catch (error) {
        console.error(error);
        setState({ message: t('channel.wechatQrLoadFailed'), stage: 'error' });
      }
    }, [disabled, onAuthenticated, stopPolling, t]);

    useEffect(() => stopPolling, [stopPolling]);

    const statusText =
      state.stage === 'ready'
        ? state.status === 'wait'
          ? t('channel.wechatQrWait')
          : state.status === 'scaned'
            ? t('channel.wechatQrScaned')
            : ''
        : '';

    return (
      <Flexbox className={styles.auth} gap={12}>
        <div className={styles.qrSlot}>
          {state.stage === 'idle' && (
            <Button
              disabled={disabled}
              icon={<QrCode size={16} />}
              type={buttonType}
              onClick={startQrFlow}
            >
              {t('channel.wechatGenerateQrCode')}
            </Button>
          )}
          {state.stage === 'loading' && <NeuralNetworkLoading size={48} />}
          {state.stage === 'ready' && <QRCode size={QR_CODE_SIZE} value={state.imageUrl} />}
          {state.stage === 'error' && (
            <Flexbox className={styles.error} gap={12}>
              <Alert showIcon message={state.message} type="warning" />
              <Button
                disabled={disabled}
                icon={<RefreshCw size={14} />}
                type={buttonType}
                onClick={startQrFlow}
              >
                {t('channel.wechatQrRefresh')}
              </Button>
            </Flexbox>
          )}
        </div>

        <Text className={styles.status} type="secondary">
          {statusText}
        </Text>

        {showTips && (
          <Text className={styles.tips} type="secondary">
            <InfoCircleOutlined style={{ marginInlineEnd: 4 }} />
            {t('channel.wechatTips')}
          </Text>
        )}
      </Flexbox>
    );
  },
);

QrCodeAuth.displayName = 'QrCodeAuth';

export default QrCodeAuth;
