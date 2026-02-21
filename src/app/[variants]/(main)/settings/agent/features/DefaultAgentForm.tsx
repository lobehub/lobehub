'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Icon, Skeleton } from '@lobehub/ui';
import { Form as AntForm } from 'antd';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import ModelSelect from '@/features/ModelSelect';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const DefaultAgentForm = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = AntForm.useForm();
  const [loading, setLoading] = useState(false);

  const [updateDefaultAgent, isUserStateInit] = useUserStore((s) => [
    s.updateDefaultAgent,
    s.isUserStateInit,
  ]);

  const defaultAgentConfig = useUserStore(
    (s) => settingsSelectors.currentSettings(s).defaultAgent?.config,
  );

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;

  const defaultAgentSettings: FormGroupItemType = {
    children: [
      {
        children: (
          <ModelSelect
            showAbility={false}
            onChange={async ({ model, provider }) => {
              setLoading(true);
              await updateDefaultAgent({ config: { model, provider } });
              setLoading(false);
            }}
          />
        ),
        desc: t('defaultAgent.model.desc'),
        label: t('defaultAgent.model.title'),
        name: 'defaultAgentConfig',
      },
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('defaultAgent.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      initialValues={{ defaultAgentConfig }}
      items={[defaultAgentSettings]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

DefaultAgentForm.displayName = 'DefaultAgentForm';

export default DefaultAgentForm;
