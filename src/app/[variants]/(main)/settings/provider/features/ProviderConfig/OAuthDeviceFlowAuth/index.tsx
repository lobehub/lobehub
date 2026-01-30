'use client';

import { CheckCircleFilled } from '@ant-design/icons';
import { CopyButton, Flexbox, Icon } from '@lobehub/ui';
import { App, Button, Modal, Typography } from 'antd';
import { cssVar } from 'antd-style';
import { ExternalLinkIcon, Loader2Icon, LogOutIcon, UnplugIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

import { useOAuthDeviceFlow } from './useOAuthDeviceFlow';

const { Text, Link } = Typography;

export interface OAuthDeviceFlowAuthProps {
  name: string;
  onAuthChange?: () => void;
  providerId: string;
}

const OAuthDeviceFlowAuth = memo<OAuthDeviceFlowAuthProps>(({ providerId, name, onAuthChange }) => {
  const { t } = useTranslation('modelProvider');
  const { modal } = App.useApp();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const hasAutoClosedRef = useRef(false);

  const utils = lambdaQuery.useUtils();

  const { data: authStatus } = lambdaQuery.oauthDeviceFlow.getAuthStatus.useQuery(
    { providerId },
    { refetchOnWindowFocus: true },
  );
  const isAuthenticated = authStatus?.isAuthenticated ?? false;

  const revokeAuth = lambdaQuery.oauthDeviceFlow.revokeAuth.useMutation({
    onSuccess: () => {
      utils.oauthDeviceFlow.getAuthStatus.invalidate({ providerId });
      onAuthChange?.();
    },
  });

  const handleSuccess = useCallback(async () => {
    await utils.oauthDeviceFlow.getAuthStatus.invalidate({ providerId });
    onAuthChange?.();
  }, [onAuthChange, providerId, utils.oauthDeviceFlow.getAuthStatus]);

  const { state, deviceCodeInfo, error, startAuth, cancelAuth } = useOAuthDeviceFlow({
    onSuccess: handleSuccess,
    providerId,
  });

  const handleDisconnect = useCallback(() => {
    modal.confirm({
      centered: true,
      content: t('providerModels.config.oauth.disconnectConfirm'),
      okButtonProps: { danger: true },
      okText: t('providerModels.config.oauth.disconnect'),
      onOk: async () => {
        await revokeAuth.mutateAsync({ providerId });
      },
      title: t('providerModels.config.oauth.disconnect'),
    });
  }, [modal, providerId, revokeAuth, t]);

  const handleStartAuth = useCallback(async () => {
    hasAutoClosedRef.current = false;
    setIsModalOpen(true);
    await startAuth();
  }, [startAuth]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    cancelAuth();
  }, [cancelAuth]);

  const handleOpenBrowser = useCallback(() => {
    if (deviceCodeInfo?.verificationUri) {
      window.open(deviceCodeInfo.verificationUri, '_blank');
    }
  }, [deviceCodeInfo?.verificationUri]);

  useEffect(() => {
    if (state === 'success' && isModalOpen && !hasAutoClosedRef.current) {
      hasAutoClosedRef.current = true;
      setIsModalOpen(false);
    }
  }, [state, isModalOpen]);

  const renderModalContent = () => {
    if (state === 'requesting') {
      return (
        <Flexbox align="center" gap={12} horizontal justify="center" style={{ minHeight: 120 }}>
          <Icon icon={Loader2Icon} spin />
          <Text>{t('providerModels.config.oauth.connecting')}</Text>
        </Flexbox>
      );
    }

    if (state === 'error' && error) {
      const errorKey = `providerModels.config.oauth.${error}`;
      return (
        <Flexbox gap={16}>
          <Flexbox align="center" gap={8} horizontal>
            <Icon color={cssVar.colorError} icon={UnplugIcon} size={18} />
            <Text type="danger">{t(errorKey as any)}</Text>
          </Flexbox>
          <Button block onClick={handleStartAuth}>
            {t('providerModels.config.oauth.retry')}
          </Button>
        </Flexbox>
      );
    }

    if (!deviceCodeInfo) {
      return (
        <Flexbox align="center" gap={12} horizontal justify="center" style={{ minHeight: 120 }}>
          <Icon icon={Loader2Icon} spin />
          <Text>{t('providerModels.config.oauth.connecting')}</Text>
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={20}>
        <Flexbox gap={8}>
          <Text type="secondary">{t('providerModels.config.oauth.enterCode')}</Text>
          <Flexbox align="center" gap={8} horizontal>
            <Flexbox
              align="center"
              flex={1}
              justify="center"
              style={{
                background: cssVar.colorFillTertiary,
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 28,
                fontWeight: 600,
                letterSpacing: 6,
                padding: '16px 20px',
              }}
            >
              {deviceCodeInfo.userCode}
            </Flexbox>
            <CopyButton content={deviceCodeInfo.userCode} size="small" />
          </Flexbox>
        </Flexbox>

        <Button
          block
          icon={<Icon icon={ExternalLinkIcon} />}
          onClick={handleOpenBrowser}
          type="primary"
        >
          {t('providerModels.config.oauth.openBrowser')}
        </Button>

        <Link href={deviceCodeInfo.verificationUri} style={{ textAlign: 'center' }} target="_blank">
          {deviceCodeInfo.verificationUri}
        </Link>

        <Flexbox
          align="center"
          gap={8}
          horizontal
          justify="center"
          style={{
            background: cssVar.colorInfoBg,
            borderRadius: 6,
            fontSize: 13,
            padding: '10px 12px',
          }}
        >
          <Icon icon={Loader2Icon} spin />
          <span>{t('providerModels.config.oauth.polling')}</span>
        </Flexbox>
      </Flexbox>
    );
  };

  if (isAuthenticated && state === 'idle') {
    return (
      <Flexbox gap={8} horizontal>
        <Button
          icon={
            <CheckCircleFilled
              style={{
                color: cssVar.colorSuccess,
              }}
            />
          }
          style={{
            borderColor: cssVar.colorSuccess,
            color: cssVar.colorSuccess,
            flex: 1,
          }}
        >
          {t('providerModels.config.oauth.authorized')}
        </Button>
        <Button
          danger
          icon={<Icon icon={LogOutIcon} />}
          loading={revokeAuth.isPending}
          onClick={handleDisconnect}
        >
          {t('providerModels.config.oauth.disconnect')}
        </Button>
      </Flexbox>
    );
  }

  if (state === 'error' && error && !isModalOpen) {
    const errorKey = `providerModels.config.oauth.${error}`;
    return (
      <Flexbox gap={8}>
        <Flexbox align="center" gap={8} horizontal>
          <Icon color={cssVar.colorError} icon={UnplugIcon} size={16} />
          <Text type="danger">{t(errorKey as any)}</Text>
        </Flexbox>
        <Button onClick={handleStartAuth} type="primary">
          {t('providerModels.config.oauth.connect', { name })}
        </Button>
      </Flexbox>
    );
  }

  return (
    <>
      <Button onClick={handleStartAuth} type="primary">
        {t('providerModels.config.oauth.connect', { name })}
      </Button>

      <Modal
        centered
        closable
        footer={null}
        maskClosable={false}
        onCancel={handleCloseModal}
        open={isModalOpen}
        title={t('providerModels.config.oauth.title')}
        width={400}
      >
        {renderModalContent()}
      </Modal>
    </>
  );
});

OAuthDeviceFlowAuth.displayName = 'OAuthDeviceFlowAuth';

export default OAuthDeviceFlowAuth;
