'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import type { FormGroupItemType } from '@lobehub/ui';
import { Button, Form, Icon } from '@lobehub/ui';
import { Switch } from 'antd';
import { HardDriveDownload, HardDriveUpload } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTransferAgentsFormItem } from '@/business/client/hooks/useTransferAgentsFormItem';
import { FORM_STYLE } from '@/const/layoutTokens';

const WorkspaceStorageContent = memo(() => {
  const { t } = useTranslation('setting');
  const transferAgentsFormItems = useTransferAgentsFormItem();

  const analytics: FormGroupItemType = {
    children: [
      {
        children: <Switch disabled />,
        desc: t('workspaceSetting.storage.telemetry.desc', { appName: BRANDING_NAME }),
        label: t('workspaceSetting.storage.telemetry.title'),
        minWidth: undefined,
        valuePropName: 'checked',
      },
    ],
    title: t('analytics.title'),
  };

  const system: FormGroupItemType = {
    children: [
      {
        children: (
          <Button disabled icon={<Icon icon={HardDriveDownload} />}>
            {t('storage.actions.import.button')}
          </Button>
        ),
        desc: t('workspaceSetting.storage.comingSoon'),
        label: t('storage.actions.import.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
      {
        children: (
          <Button disabled icon={<Icon icon={HardDriveUpload} />}>
            {t('storage.actions.export.button')}
          </Button>
        ),
        desc: t('workspaceSetting.storage.comingSoon'),
        label: t('storage.actions.export.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
      {
        children: (
          <Button danger disabled type={'primary'}>
            {t('danger.reset.action')}
          </Button>
        ),
        desc: t('workspaceSetting.storage.danger.reset.desc'),
        label: t('workspaceSetting.storage.danger.reset.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
    ],
    title: t('storage.actions.title'),
  };

  const dataMigration: FormGroupItemType | undefined = transferAgentsFormItems
    ? {
        children: transferAgentsFormItems,
        title: t('storage.migration.title'),
      }
    : undefined;

  return (
    <Form
      collapsible={false}
      items={[analytics, ...(dataMigration ? [dataMigration] : []), system]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

WorkspaceStorageContent.displayName = 'WorkspaceStorageContent';

export default WorkspaceStorageContent;
