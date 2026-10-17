import { SliderWithInput, Switch } from '@lobehub/ui';
import { Form, type FormFieldProps, useForm } from '@lobehub/ui/form';
import { debounce } from 'es-toolkit/compat';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

interface HistoryValues {
  enableHistoryCount?: boolean;
  historyCount?: number;
}

const Controls = () => {
  const { t } = useTranslation('setting');
  const [updating, setUpdating] = useState(false);
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();

  const [historyCount, enableHistoryCount] = useAgentStore((s) => [
    chatConfigByIdSelectors.getHistoryCountById(agentId)(s),
    chatConfigByIdSelectors.getEnableHistoryCountById(agentId)(s),
  ]);

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

  const form = useForm<HistoryValues>({
    initialValues: { enableHistoryCount, historyCount },
    onValuesChange: handleValuesChange,
  });

  // Sync external store updates to the form without remounting to keep Switch animation
  useEffect(() => {
    form.setValues({ enableHistoryCount, historyCount });
  }, [enableHistoryCount, historyCount, form]);

  const items: FormFieldProps<HistoryValues>[] = [
    {
      children: <Switch loading={updating} size={'small'} />,
      label: t('settingChat.enableHistoryCount.title'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'enableHistoryCount',
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
      bare: true,
      name: 'historyCount',
    },
  ];

  return (
    <Form
      form={form}
      items={items}
      itemsType={'flat'}
      styles={{
        group: {
          background: 'transparent',
        },
      }}
    />
  );
};

export default Controls;
