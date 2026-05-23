'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { type FormGroupItemType } from '@lobehub/ui';
import { Button, Form, Icon } from '@lobehub/ui';
import { App, Switch } from 'antd';
import { HardDriveDownload, HardDriveUpload } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AccountDeletion from '@/business/client/features/AccountDeletion';
import { FORM_STYLE } from '@/const/layoutTokens';
import DataImporter from '@/features/DataImporter';
import { configService } from '@/services/config';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';
import { useServerConfigStore } from '@/store/serverConfig';
import { featureFlagsSelectors, serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useSessionStore } from '@/store/session';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const AdvancedActions = () => {
  const { t } = useTranslation('setting');
  const { message, modal } = App.useApp();
  const { hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const checked = useUserStore(userGeneralSettingsSelectors.telemetry);
  const [clearSessions, clearSessionGroups] = useSessionStore((s) => [
    s.clearSessions,
    s.clearSessionGroups,
  ]);
  const [clearTopics, clearAllMessages] = useChatStore((s) => [
    s.removeAllTopics,
    s.clearAllMessages,
  ]);
  const [removeAllFiles] = useFileStore((s) => [s.removeAllFiles]);
  const removeAllPlugins = useToolStore((s) => s.removeAllPlugins);
  const resetSettings = useUserStore((s) => s.resetSettings);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  const handleClear = useCallback(() => {
    modal.confirm({
      centered: true,
      okButtonProps: {
        danger: true,
      },
      onOk: async () => {
        await clearSessions();
        await removeAllPlugins();
        await clearTopics();
        await removeAllFiles();
        await clearAllMessages();
        await clearSessionGroups();

        message.success(t('danger.clear.success'));
      },
      title: t('danger.clear.confirm'),
    });
  }, [
    clearAllMessages,
    clearSessionGroups,
    clearSessions,
    clearTopics,
    message,
    modal,
    removeAllFiles,
    removeAllPlugins,
    t,
  ]);

  const handleReset = useCallback(() => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: () => {
        resetSettings();
        message.success(t('danger.reset.success'));
      },
      title: t('danger.reset.confirm'),
    });
  }, [message, modal, resetSettings, t]);

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
          <Button danger type={'primary'} onClick={handleClear}>
            {t('danger.clear.action')}
          </Button>
        ),
        desc: t('danger.clear.desc'),
        label: t('danger.clear.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
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

  return (
    <>
      <Form
        collapsible={false}
        items={hideDocs ? [analytics, system] : [system]}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
      {enableBusinessFeatures && <AccountDeletion />}
    </>
  );
};

export default AdvancedActions;
