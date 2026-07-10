'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import type { FormGroupItemType } from '@lobehub/ui';
import { Button, Form, Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App, Switch } from 'antd';
import { HardDriveDownload, HardDriveUpload } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AccountDeletion from '@/business/client/features/AccountDeletion';
import { useTransferAgentsFormItem } from '@/business/client/hooks/useTransferAgentsFormItem';
import { FORM_STYLE } from '@/const/layoutTokens';
import DataImporter from '@/features/DataImporter';
import { configService } from '@/services/config';
import { useServerConfigStore } from '@/store/serverConfig';
import { featureFlagsSelectors, serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const AdvancedActions = () => {
  const { t } = useTranslation(['setting', 'common']);
  const { message } = App.useApp();
  const { hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const checked = useUserStore(userGeneralSettingsSelectors.telemetry);
  const transferAgentsFormItems = useTransferAgentsFormItem();
  const resetSettings = useUserStore((s) => s.resetSettings);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  const handleReset = useCallback(() => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('danger.reset.confirm'),
      okButtonProps: { danger: true },
      okText: t('danger.reset.action'),
      onOk: () => {
        resetSettings();
        message.success(t('danger.reset.success'));
      },
      title: t('danger.reset.title'),
    });
  }, [message, resetSettings, t]);

  const renderExportButtonFormItem = () => {
    return {
      children: (
        <Button
          icon={<Icon icon={HardDriveUpload} />}
          onClick={() => {
            configService.exportAll();
          }}
        >
          {t('storage.actions.export.button')}
        </Button>
      ),
      label: t('storage.actions.export.title'),
      layout: 'horizontal',
      minWidth: undefined,
    } as const;
  };

  const system: FormGroupItemType = {
    children: [
      {
        children: (
          <DataImporter>
            <Button icon={<Icon icon={HardDriveDownload} />}>
              {t('storage.actions.import.button')}
            </Button>
          </DataImporter>
        ),
        label: t('storage.actions.import.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
      ...(enableBusinessFeatures ? [renderExportButtonFormItem()] : []),
      {
        children: (
          <Button danger type={'primary'} onClick={handleReset}>
            {t('danger.reset.action')}
          </Button>
        ),
        desc: t('danger.reset.desc'),
        label: t('danger.reset.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
    ],
    title: t('storage.actions.title'),
  };

  const analytics: FormGroupItemType = {
    children: [
      {
        children: (
          <Switch
            checked={!!checked}
            onChange={(value) => {
              updateGeneralConfig({ telemetry: value });
            }}
          />
        ),
        desc: t('analytics.telemetry.desc', { appName: BRANDING_NAME }),
        label: t('analytics.telemetry.title'),
        minWidth: undefined,
        valuePropName: 'checked',
      },
    ],
    title: t('analytics.title'),
  };

  const dataMigration: FormGroupItemType | undefined = transferAgentsFormItems
    ? {
        children: transferAgentsFormItems,
        title: t('storage.migration.title'),
      }
    : undefined;

  return (
    <>
      <Form
        collapsible={false}
        itemsType={'group'}
        variant={'filled'}
        items={[
          ...(hideDocs ? [analytics] : []),
          ...(dataMigration ? [dataMigration] : []),
          system,
        ]}
        {...FORM_STYLE}
      />
      {enableBusinessFeatures && <AccountDeletion />}
    </>
  );
};

export default AdvancedActions;
