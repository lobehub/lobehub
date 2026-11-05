'use client';

import { Alert, Button, type ButtonProps, Flexbox, Icon, QRCode, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { InfoIcon, QrCode, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentBotProviderService } from '@/services/agentBotProvider';

const QR_CODE_SIZE = 188;
const QR_POLL_INTERVAL_MS = 2000;
const QR_SLOT_SIZE = 240;

const styles = stylex.create({
  auth: { alignItems: 'center', width: '100%' },
  error: { alignItems: 'center', width: '100%' },
  qrSlot: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${QR_SLOT_SIZE}px`,
    height: `${QR_SLOT_SIZE}px`,
    padding: '9px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  status: { minHeight: '20px', fontSize: '13px', textAlign: 'center' },
  tips: { maxWidth: '480px', fontSize: '13px', textAlign: 'center' },
});

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
      <Flexbox className={stylex.props(styles.auth).className} gap={12}>
        <div {...stylex.props(styles.qrSlot)}>
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
          {state.stage === 'loading' && <Spin size="large" />}
          {state.stage === 'ready' && <QRCode size={QR_CODE_SIZE} value={state.imageUrl} />}
          {state.stage === 'error' && (
            <Flexbox className={stylex.props(styles.error).className} gap={12}>
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

        <Text className={stylex.props(styles.status).className} type="secondary">
          {statusText}
        </Text>

        {showTips && (
          <Text className={stylex.props(styles.tips).className} type="secondary">
            <Icon icon={InfoIcon} style={{ marginInlineEnd: 4 }} />
            {t('channel.wechatTips')}
          </Text>
        )}
      </Flexbox>
    );
  },
);

QrCodeAuth.displayName = 'QrCodeAuth';

export default QrCodeAuth;
