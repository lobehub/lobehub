'use client';

import type { ProviderImportPayload, ProviderImportPreview } from '@lobechat/electron-client-ipc';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { Alert, Button, ModalFooter, Text, toast, useModalContext } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { ensureElectronIpc } from '@/utils/electron/ipc';

import {
  applyProviderImport,
  BuiltinProviderImportError,
  PartialProviderImportError,
  ProviderOverwriteNotConfirmedError,
} from './applyProviderImport';
import type { ExistingProviderPreview } from './types';

interface ProviderImportContentProps {
  existingProvider?: ExistingProviderPreview;
  preview: ProviderImportPreview;
}

const ProviderImportContent = memo<ProviderImportContentProps>(({ existingProvider, preview }) => {
  const { t } = useTranslation('modelProvider');
  const { close } = useModalContext();
  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');
  const [loading, setLoading] = useState(false);
  const payloadRef = useRef<ProviderImportPayload | undefined>(undefined);
  const retryProviderIdentityRef = useRef<string | undefined>(undefined);
  const { modelCount, provider, requestId } = preview;
  const isBuiltinConflict = existingProvider?.source === 'builtin';
  const isOverwrite = existingProvider?.source === 'custom';

  const handleCancel = () => {
    void ensureElectronIpc().providerImport.cancel(requestId);
    close();
  };

  const handleImport = async () => {
    if (isBuiltinConflict || !canManageProvider) return;
    setLoading(true);

    try {
      const payload =
        payloadRef.current ?? (await ensureElectronIpc().providerImport.consume(requestId));
      if (!payload) {
        toast.error(t('providerImport.error.expired'));
        close();
        return;
      }

      payloadRef.current = payload;
      await applyProviderImport(payload, {
        expectedProviderIdentity: existingProvider?.identity ?? retryProviderIdentityRef.current,
      });
      toast.success(t('providerImport.success', { name: provider.name }));
      close();
    } catch (error) {
      if (error instanceof PartialProviderImportError) {
        retryProviderIdentityRef.current = error.providerIdentity;
      }
      console.error('Failed to import provider configuration', error);
      toast.error(
        t(
          error instanceof BuiltinProviderImportError
            ? 'providerImport.error.builtinConflict'
            : error instanceof ProviderOverwriteNotConfirmedError
              ? 'providerImport.error.providerChanged'
              : error instanceof PartialProviderImportError
                ? 'providerImport.error.partial'
                : 'providerImport.error.apply',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16}>
      {isBuiltinConflict ? (
        <Alert
          showIcon
          description={t('providerImport.error.builtinConflict')}
          title={t('providerImport.conflictTitle')}
          type={'error'}
        />
      ) : isOverwrite ? (
        <Alert
          showIcon
          title={t('providerImport.overwriteTitle')}
          type={'warning'}
          description={t('providerImport.overwriteDescription', {
            id: existingProvider.id,
            name: existingProvider.name,
          })}
        />
      ) : (
        <Alert
          showIcon
          description={t('providerImport.securityDescription')}
          title={t('providerImport.securityTitle')}
          type={'info'}
        />
      )}
      <Flexbox gap={8}>
        <Flexbox horizontal justify={'space-between'}>
          <Text type={'secondary'}>{t('providerImport.provider')}</Text>
          <Text weight={500}>{provider.name}</Text>
        </Flexbox>
        <Flexbox horizontal justify={'space-between'}>
          <Text type={'secondary'}>{t('providerImport.providerId')}</Text>
          <Text code>{provider.id}</Text>
        </Flexbox>
        <Flexbox horizontal justify={'space-between'}>
          <Text type={'secondary'}>{t('providerImport.endpoint')}</Text>
          <Text code>{provider.baseURL}</Text>
        </Flexbox>
        <Flexbox horizontal justify={'space-between'}>
          <Text type={'secondary'}>{t('providerImport.models')}</Text>
          <Text>{t('providerImport.modelCount', { count: modelCount })}</Text>
        </Flexbox>
      </Flexbox>
      <Text color={cssVar.colorTextTertiary} fontSize={12}>
        {t('providerImport.secretNotice')}
      </Text>
      <ModalFooter>
        <Button disabled={loading} onClick={handleCancel}>
          {t('providerImport.cancel')}
        </Button>
        <Tooltip title={canManageProvider ? undefined : reason}>
          <Button
            danger={isOverwrite}
            disabled={isBuiltinConflict || !canManageProvider}
            loading={loading}
            type={'primary'}
            onClick={handleImport}
          >
            {t(isOverwrite ? 'providerImport.confirmOverwrite' : 'providerImport.confirm')}
          </Button>
        </Tooltip>
      </ModalFooter>
    </Flexbox>
  );
});

ProviderImportContent.displayName = 'ProviderImportContent';

export default ProviderImportContent;
