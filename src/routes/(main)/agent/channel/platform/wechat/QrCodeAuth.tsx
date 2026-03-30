'use client';

import { InfoCircleOutlined } from '@ant-design/icons';
import { Alert, Button, type ButtonProps, Modal, QRCode, Spin, Typography } from 'antd';
import { QrCode, RefreshCw } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentBotProviderService } from '@/services/agentBotProvider';

const QR_POLL_INTERVAL_MS = 2000;

interface QrCodeAuthProps {
  buttonLabel?: string;
  buttonType?: ButtonProps['type'];
  onAuthenticated: (credentials: { botId: string; botToken: string; userId: string }) => void;
  showTips?: boolean;
}

const QrCodeAuth = memo<QrCodeAuthProps>(
  ({ buttonLabel, buttonType = 'primary', onAuthenticated, showTips = true }) => {
    const { t } = useTranslation('agent');
    const [open, setOpen] = useState(false);
    const [qrImgUrl, setQrImgUrl] = useState<string>();
    const [status, setStatus] = useState<string>('');
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(false);
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
      setLoading(true);
      setError(undefined);
      setStatus('');
      setQrImgUrl(undefined);
      stopPolling();

      try {
        const qr = await agentBotProviderService.wechatGetQrCode();
        setQrImgUrl(qr.qrcode_img_content);
        setStatus('wait');
        setLoading(false);

        // Start polling
        pollingRef.current = true;
        const poll = async () => {
          if (!pollingRef.current) return;

          try {
            const res = await agentBotProviderService.wechatPollQrStatus(qr.qrcode);
            if (!pollingRef.current) return;

            setStatus(res.status);

            if (res.status === 'confirmed' && res.bot_token) {
              stopPolling();
              onAuthenticated({
                botId: res.ilink_bot_id || '',
                botToken: res.bot_token,
                userId: res.ilink_user_id || '',
              });
              setOpen(false);
              return;
            }

            if (res.status === 'expired') {
              stopPolling();
              setError(t('channel.wechatQrExpired'));
              return;
            }

            timerRef.current = setTimeout(poll, QR_POLL_INTERVAL_MS);
          } catch {
            if (pollingRef.current) {
              timerRef.current = setTimeout(poll, QR_POLL_INTERVAL_MS);
            }
          }
        };

        timerRef.current = setTimeout(poll, QR_POLL_INTERVAL_MS);
      } catch (err: any) {
        setError(err?.message || 'Failed to get QR code');
        setLoading(false);
      }
    }, [onAuthenticated, stopPolling, t]);

    const handleOpen = useCallback(() => {
      setOpen(true);
      startQrFlow();
    }, [startQrFlow]);

    const handleClose = useCallback(() => {
      stopPolling();
      setOpen(false);
    }, [stopPolling]);

    const statusText =
      status === 'wait'
        ? t('channel.wechatQrWait')
        : status === 'scaned'
          ? t('channel.wechatQrScaned')
          : '';

    return (
      <>
        <div style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Button icon={<QrCode size={16} />} type={buttonType} onClick={handleOpen}>
            {buttonLabel || t('channel.wechatScanToConnect')}
          </Button>
          {showTips && (
            <Typography.Text style={{ maxWidth: 480, textAlign: 'center' }} type="secondary">
              <InfoCircleOutlined style={{ marginInlineEnd: 4 }} />
              {t('channel.wechatTips')}
            </Typography.Text>
          )}
        </div>

        <Modal
          centered
          footer={null}
          open={open}
          title={t('channel.wechatScanTitle')}
          width={460}
          onCancel={handleClose}
        >
          <div
            style={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              padding: '16px 0',
            }}
          >
            {loading && <Spin size="large" />}

            {qrImgUrl && !error && <QRCode size={240} value={qrImgUrl} />}

            {statusText && !error && (
              <Typography.Text type="secondary">{statusText}</Typography.Text>
            )}

            {error && (
              <>
                <Alert showIcon message={error} type="warning" />
                <Button icon={<RefreshCw size={14} />} onClick={startQrFlow}>
                  {t('channel.wechatQrRefresh')}
                </Button>
              </>
            )}
          </div>
        </Modal>
      </>
    );
  },
);

export default QrCodeAuth;
