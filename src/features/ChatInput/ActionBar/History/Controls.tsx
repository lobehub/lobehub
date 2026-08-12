import { type FormItemProps } from '@lobehub/ui';
import { Form, SliderWithInput } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { Form as AntdForm } from 'antd';
import { debounce } from 'es-toolkit/compat';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const Controls = () => {
  const { t } = useTranslation('setting');
  const [form] = AntdForm.useForm();
  const [updating, setUpdating] = useState(false);
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();

  const [historyCount, enableHistoryCount] = useAgentStore((s) => [
    chatConfigByIdSelectors.getHistoryCountById(agentId)(s),
    chatConfigByIdSelectors.getEnableHistoryCountById(agentId)(s),
  ]);

  // Sync external store updates to the form without remounting to keep Switch animation
  useEffect(() => {
    form?.setFieldsValue({
      enableHistoryCount,
      historyCount,
    });
  }, [enableHistoryCount, historyCount, form]);

  const handleValuesChange = useMemo(
    () =>
      debounce(async (values) => {
        setUpdating(true);
        try {
          await updateAgentChatConfig(values);
        } finally {
          setUpdating(false);
        }
      }, 500),
    [updateAgentChatConfig],
  );

  useEffect(() => () => handleValuesChange.cancel(), [handleValuesChange]);

  const items: FormItemProps[] = [
    {
      children: <Switch loading={updating} size={'small'} />,
      label: t('settingChat.enableHistoryCount.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'enableHistoryCount',
      valuePropName: 'checked',
    },
    {
      children: (
        <SliderWithInput
          disabled={!enableHistoryCount}
          max={20}
          min={0}
          size={'small'}
          step={1}
          style={{ marginBlock: 8, paddingLeft: 4 }}
          unlimitedInput={true}
          styles={{
            input: {
              maxWidth: 64,
            },
          }}
        />
      ),
      name: 'historyCount',
      noStyle: true,
    },
  ];

  return (
    <Form
      form={form}
      items={items}
      itemsType={'flat'}
      initialValues={{
        enableHistoryCount,
        historyCount,
      }}
      styles={{
        group: {
          background: 'transparent',
        },
      }}
      onValuesChange={handleValuesChange}
    />
  );
};

export default Controls;
