'use client';

import { BRANDING_NAME, ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { DEFAULT_SETTINGS } from '@lobechat/config';
import { Button, Form, type FormGroupItemType, Icon } from '@lobehub/ui';
import { App, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { HardDriveDownload, HardDriveUpload } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import DataImporter from '@/features/DataImporter';
import { configService } from '@/services/config';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';
import { useSessionStore } from '@/store/session';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const AdvancedActions = () => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const { message, modal } = App.useApp();
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
  const settings = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, resetSettings] = useUserStore((s) => [s.setSettings, s.resetSettings]);

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
  }, []);

  const handleReset = useCallback(() => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: () => {
        resetSettings();
        form.setFieldsValue(DEFAULT_SETTINGS);
        message.success(t('danger.reset.success'));
      },
      title: t('danger.reset.confirm'),
    });
  }, []);

  const analytics: FormGroupItemType = {
    children: [
      {
        children: <Switch />,
        desc: t('analytics.telemetry.desc', { appName: BRANDING_NAME }),
        label: t('analytics.telemetry.title'),
        minWidth: undefined,
        name: ['general', 'telemetry'],
        valuePropName: 'checked',
      },
    ],
    title: t('analytics.title'),
  };

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
      ...(ENABLE_BUSINESS_FEATURES ? [renderExportButtonFormItem()] : []),
      {
        children: (
          <Button danger onClick={handleClear} type={'primary'}>
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
          <Button danger onClick={handleReset} type={'primary'}>
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
  return (
    <Form
      collapsible={false}
      form={form}
      initialValues={settings}
      items={[analytics, system]}
      itemsType={'group'}
      onValuesChange={setSettings}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
};

export default AdvancedActions;
