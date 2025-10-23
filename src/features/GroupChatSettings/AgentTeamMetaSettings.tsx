'use client';

import { Form, type FormGroupItemType, Icon, Segmented } from '@lobehub/ui';
import { useUpdateEffect } from 'ahooks';
import { Input } from 'antd';
import isEqual from 'fast-deep-equal';
import { Briefcase, Coffee } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';

import { selectors, useStore } from './store';

const { TextArea } = Input;

const AgentTeamMetaSettings = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const [form] = Form.useForm();

  const updateMeta = useStore((s) => s.updateGroupMeta);
  const meta = useStore(selectors.currentMetaConfig, isEqual) || {};
  const updateConfig = useStore((s) => s.updateGroupConfig);
  const config = useStore(selectors.currentChatConfig, isEqual) || {};

  useUpdateEffect(() => {
    form.setFieldsValue({ ...meta, scene: config.scene });
  }, [meta, config?.scene]);

  const groupSettings: FormGroupItemType = {
    children: [
      {
        children: <Input placeholder={t('settingGroup.name.placeholder')} />,
        label: t('settingGroup.name.title'),
        name: 'title',
      },
      {
        children: (
          <TextArea
            autoSize={{ maxRows: 10, minRows: 5 }}
            placeholder={t('settingGroup.description.placeholder')}
            rows={4}
          />
        ),
        label: t('settingGroup.description.title'),
        name: 'description',
      },
      {
        children: (
          <Segmented
            options={[
              {
                icon: <Icon icon={Coffee} size={16} />,
                label: t('settingGroup.scene.options.casual'),
                value: 'casual',
              },
              {
                icon: <Icon icon={Briefcase} size={16} />,
                label: t('settingGroup.scene.options.productive'),
                value: 'productive',
              },
            ]}
          />
        ),
        desc: t('settingGroup.scene.desc'),
        label: t('settingGroup.scene.title'),
        minWidth: undefined,
        name: 'scene',
      },
    ],
    title: t('settingGroup.title'),
  };

  return (
    <Form
      footer={
        <Form.SubmitFooter
          texts={{
            reset: t('submitFooter.reset'),
            submit: t('submitFooter.submit'),
            unSaved: t('submitFooter.unSaved'),
            unSavedWarning: t('submitFooter.unSavedWarning'),
          }}
        />
      }
      form={form}
      initialValues={{ ...meta, scene: config.scene }}
      items={[groupSettings]}
      itemsType={'group'}
      onFinish={async (values) => {
        const { scene, ...metaPayload } = values as any;
        await updateMeta(metaPayload);
        if (scene && scene !== config.scene) {
          await updateConfig({ scene });
        }
      }}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

export default AgentTeamMetaSettings;
