'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Button, Icon, Switch } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { HardDriveDownload, HardDriveUpload } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTransferAgentsFormItem } from '@/business/client/hooks/useTransferAgentsFormItem';
import { FORM_STYLE } from '@/const/layoutTokens';

const WorkspaceStorageContent = memo(() => {
  const { t } = useTranslation('setting');
  const transferAgentsFormItems = useTransferAgentsFormItem();
  const form = useForm();

  const analytics: FormGroupItem = {
    children: [
      {
        children: <Switch disabled />,
        desc: t('workspaceSetting.storage.telemetry.desc', { appName: BRANDING_NAME }),
        label: t('workspaceSetting.storage.telemetry.title'),
        minWidth: undefined,
      },
    ],
    title: t('analytics.title'),
  };

  const system: FormGroupItem = {
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
    ],
    title: t('storage.actions.title'),
  };

  const dataMigration: FormGroupItem | undefined = transferAgentsFormItems
    ? {
        children: transferAgentsFormItems,
        title: t('storage.migration.title'),
      }
    : undefined;

  return (
    <Form
      collapsible={false}
      form={form}
      items={[analytics, ...(dataMigration ? [dataMigration] : []), system]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

WorkspaceStorageContent.displayName = 'WorkspaceStorageContent';

export default WorkspaceStorageContent;
