import { type FormItemProps } from '@lobehub/ui';
import { Form, SliderWithInput } from '@lobehub/ui';
import { Form as AntdForm, Switch } from 'antd';
import { debounce } from 'es-toolkit/compat';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

interface ControlsProps {
  setUpdating: (updating: boolean) => void;
  updating: boolean;
}
const Controls = memo<ControlsProps>(({ updating, setUpdating }) => {
  const { t } = useTranslation('setting');
  const [form] = AntdForm.useForm();
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
      onValuesChange={debounce(async (values) => {
        setUpdating(true);
        await updateAgentChatConfig(values);
        setUpdating(false);
      }, 500)}
    />
  );
});

export default Controls;
