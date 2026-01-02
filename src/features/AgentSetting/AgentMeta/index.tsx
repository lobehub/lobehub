'use client';

import { Button, Form, type FormGroupItemType, type FormItemProps, Tooltip } from '@lobehub/ui';
import { useUpdateEffect } from 'ahooks';
import isEqual from 'fast-deep-equal';
import { Wand2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { INBOX_SESSION_ID } from '@/const/session';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import { selectors, useStore } from '../store';
import AutoGenerateAvatar from './AutoGenerateAvatar';
import AutoGenerateInput from './AutoGenerateInput';
import AutoGenerateSelect from './AutoGenerateSelect';
import BackgroundSwatches from './BackgroundSwatches';

const AgentMeta = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);
  const [hasSystemRole, updateMeta, autocompleteMeta, autocompleteAllMeta] = useStore((s) => [
    !!s.config.systemRole,
    s.setAgentMeta,
    s.autocompleteMeta,
    s.autocompleteAllMeta,
  ]);
  const [isInbox, loadingState] = useStore((s) => [s.id === INBOX_SESSION_ID, s.loadingState]);
  const meta = useStore(selectors.currentMetaConfig, isEqual);
  const [background, setBackground] = useState(meta.backgroundColor);

  useUpdateEffect(() => {
    form.setFieldsValue(meta);
  }, [meta]);

  if (isInbox) return;

  const basic = [
    {
      Render: AutoGenerateInput,
      key: 'title',
      label: t('settingAgent.name.title'),
      placeholder: t('settingAgent.name.placeholder'),
    },
    {
      Render: AutoGenerateInput,
      desc: t('settingAgent.description.desc'),
      key: 'description',
      label: t('settingAgent.description.title'),
      placeholder: t('settingAgent.description.placeholder'),
    },
    {
      Render: AutoGenerateSelect,
      desc: t('settingAgent.tag.desc'),
      key: 'tags',
      label: t('settingAgent.tag.title'),
      placeholder: t('settingAgent.tag.placeholder'),
    },
  ];

  const autocompleteItems: FormItemProps[] = basic.map((item) => {
    const AutoGenerate = item.Render;
    return {
      children: (
        <AutoGenerate
          canAutoGenerate={hasSystemRole}
          loading={loadingState?.[item.key]}
          onGenerate={() => {
            autocompleteMeta(item.key as keyof typeof meta);
          }}
          placeholder={item.placeholder}
        />
      ),
      label: item.label,
      name: item.key,
    };
  });

  const metaData: FormGroupItemType = {
    children: [
      {
        children: (
          <AutoGenerateAvatar
            background={background}
            canAutoGenerate={hasSystemRole}
            loading={loadingState?.['avatar']}
            onGenerate={() => autocompleteMeta('avatar')}
          />
        ),
        label: t('settingAgent.avatar.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'avatar',
      },
      {
        children: <BackgroundSwatches onValuesChange={(c) => setBackground(c)} />,
        label: t('settingAgent.backgroundColor.title'),
        minWidth: undefined,
        name: 'backgroundColor',
      },
      ...autocompleteItems,
    ],
    extra: (
      <Tooltip
        title={
          !hasSystemRole
            ? t('autoGenerateTooltipDisabled', { ns: 'common' })
            : t('autoGenerateTooltip', { ns: 'common' })
        }
      >
        <Button
          disabled={!hasSystemRole}
          icon={Wand2}
          iconPlacement={'end'}
          iconProps={{
            size: 12,
          }}
          loading={Object.values(loadingState as any).some((i) => !!i)}
          onClick={(e: any) => {
            e.stopPropagation();
            autocompleteAllMeta(true);
          }}
          size={'small'}
        >
          {t('autoGenerate', { ns: 'common' })}
        </Button>
      </Tooltip>
    ),
    title: t('settingAgent.title'),
  };

  return (
    <Form
      disabled={!isAgentEditable}
      footer={<Form.SubmitFooter />}
      form={form}
      initialValues={meta}
      items={[metaData]}
      itemsType={'group'}
      onFinish={updateMeta}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

export default AgentMeta;
