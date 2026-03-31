import { type FormItemProps } from '@lobehub/ui';
import { Checkbox, Flexbox, Form, SliderWithInput, Tag } from '@lobehub/ui';
import { Form as AntdForm, Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { type ComponentType } from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import InfoTooltip from '@/components/InfoTooltip';
import {
  FrequencyPenalty,
  PresencePenalty,
  Temperature,
  TopP,
} from '@/features/ModelParamsControl';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

interface ControlsProps {
  setUpdating: (updating: boolean) => void;
  updating: boolean;
}

type ParamKey = 'temperature' | 'top_p' | 'presence_penalty' | 'frequency_penalty';

type ParamLabelKey =
  | 'settingModel.temperature.title'
  | 'settingModel.topP.title'
  | 'settingModel.presencePenalty.title'
  | 'settingModel.frequencyPenalty.title';

type ParamDescKey =
  | 'settingModel.temperature.desc'
  | 'settingModel.topP.desc'
  | 'settingModel.presencePenalty.desc'
  | 'settingModel.frequencyPenalty.desc';

const styles = createStaticStyles(({ css, cssVar }) => ({
  checkbox: css`
    .ant-checkbox-inner {
      border-radius: 4px;
    }

    &:hover .ant-checkbox-inner {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  label: css`
    user-select: none;
  `,
  sliderWrapper: css`
    display: flex;
    gap: 16px;
    align-items: center;
    width: 100%;
  `,
}));

// Wrapper component to handle checkbox + slider
interface ParamControlWrapperProps {
  checked: boolean;
  Component: ComponentType<any>;
  disabled: boolean;
  onChange?: (value: number) => void;
  onToggle: (checked: boolean) => void;
  styles: any;
  value?: number;
}

const ParamControlWrapper = memo<ParamControlWrapperProps>(
  ({ Component, value, onChange, disabled, checked, onToggle, styles }) => {
    return (
      <div className={styles.sliderWrapper}>
        <Checkbox
          checked={checked}
          className={styles.checkbox}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(!checked);
          }}
        />
        <div style={{ flex: 1 }}>
          <Component disabled={disabled} value={value} onChange={onChange} />
        </div>
      </div>
    );
  },
);

const PARAM_NAME_MAP: Record<ParamKey, (string | number)[]> = {
  frequency_penalty: ['params', 'frequency_penalty'],
  presence_penalty: ['params', 'presence_penalty'],
  temperature: ['params', 'temperature'],
  top_p: ['params', 'top_p'],
};

const PARAM_DEFAULTS: Record<ParamKey, number> = {
  frequency_penalty: 0,
  presence_penalty: 0,
  temperature: 0.7,
  top_p: 1,
};

const PARAM_CONFIG = {
  frequency_penalty: {
    Component: FrequencyPenalty,
    descKey: 'settingModel.frequencyPenalty.desc',
    labelKey: 'settingModel.frequencyPenalty.title',
    tag: 'frequency_penalty',
  },
  presence_penalty: {
    Component: PresencePenalty,
    descKey: 'settingModel.presencePenalty.desc',
    labelKey: 'settingModel.presencePenalty.title',
    tag: 'presence_penalty',
  },
  temperature: {
    Component: Temperature,
    descKey: 'settingModel.temperature.desc',
    labelKey: 'settingModel.temperature.title',
    tag: 'temperature',
  },
  top_p: {
    Component: TopP,
    descKey: 'settingModel.topP.desc',
    labelKey: 'settingModel.topP.title',
    tag: 'top_p',
  },
} satisfies Record<
  ParamKey,
  {
    Component: ComponentType<any>;
    descKey: ParamDescKey;
    labelKey: ParamLabelKey;
    tag: string;
  }
>;

const Controls = memo<ControlsProps>(({ setUpdating, updating }) => {
  const { t } = useTranslation('setting');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const agentId = useAgentId();
  const { updateAgentConfig } = useUpdateAgentConfig();

  const config = useAgentStore((s) => agentByIdSelectors.getAgentConfigById(agentId)(s), isEqual);
  const [form] = Form.useForm();

  const enableMaxTokens = AntdForm.useWatch(['chatConfig', 'enableMaxTokens'], form);
  const enableHistoryCount = AntdForm.useWatch(['chatConfig', 'enableHistoryCount'], form);
  const { frequency_penalty, presence_penalty, temperature, top_p } = config.params ?? {};

  const historyCountFromStore = useAgentStore((s) =>
    chatConfigByIdSelectors.getHistoryCountById(agentId)(s),
  );
  // Use raw chatConfig value, not the selector with business logic that may force false
  const enableHistoryCountFromStore = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).enableHistoryCount,
  );

  const lastValuesRef = useRef<Record<ParamKey, number | undefined>>({
    frequency_penalty,
    presence_penalty,
    temperature,
    top_p,
  });

  useEffect(() => {
    form.setFieldsValue(config);

    if (typeof temperature === 'number') lastValuesRef.current.temperature = temperature;
    if (typeof top_p === 'number') lastValuesRef.current.top_p = top_p;
    if (typeof presence_penalty === 'number') {
      lastValuesRef.current.presence_penalty = presence_penalty;
    }
    if (typeof frequency_penalty === 'number') {
      lastValuesRef.current.frequency_penalty = frequency_penalty;
    }
  }, [config, form, frequency_penalty, presence_penalty, temperature, top_p]);

  // Sync history count values to form
  useEffect(() => {
    // Skip syncing when updating to avoid overwriting user's in-progress edits
    if (updating) return;

    form.setFieldsValue({
      chatConfig: {
        ...form.getFieldValue('chatConfig'),
        enableHistoryCount: enableHistoryCountFromStore,
        historyCount: historyCountFromStore,
      },
    });
  }, [form, enableHistoryCountFromStore, historyCountFromStore, updating]);

  const temperatureValue = AntdForm.useWatch(PARAM_NAME_MAP.temperature, form);
  const topPValue = AntdForm.useWatch(PARAM_NAME_MAP.top_p, form);
  const presencePenaltyValue = AntdForm.useWatch(PARAM_NAME_MAP.presence_penalty, form);
  const frequencyPenaltyValue = AntdForm.useWatch(PARAM_NAME_MAP.frequency_penalty, form);

  useEffect(() => {
    if (typeof temperatureValue === 'number') lastValuesRef.current.temperature = temperatureValue;
  }, [temperatureValue]);

  useEffect(() => {
    if (typeof topPValue === 'number') lastValuesRef.current.top_p = topPValue;
  }, [topPValue]);

  useEffect(() => {
    if (typeof presencePenaltyValue === 'number') {
      lastValuesRef.current.presence_penalty = presencePenaltyValue;
    }
  }, [presencePenaltyValue]);

  useEffect(() => {
    if (typeof frequencyPenaltyValue === 'number') {
      lastValuesRef.current.frequency_penalty = frequencyPenaltyValue;
    }
  }, [frequencyPenaltyValue]);

  const enabledMap: Record<ParamKey, boolean> = {
    frequency_penalty: typeof frequencyPenaltyValue === 'number',
    presence_penalty: typeof presencePenaltyValue === 'number',
    temperature: typeof temperatureValue === 'number',
    top_p: typeof topPValue === 'number',
  };

  const handleToggle = useCallback(
    async (key: ParamKey, enabled: boolean) => {
      const namePath = PARAM_NAME_MAP[key];
      let newValue: number | undefined;

      if (!enabled) {
        const currentValue = form.getFieldValue(namePath);
        if (typeof currentValue === 'number') {
          lastValuesRef.current[key] = currentValue;
        }
        newValue = undefined;
        form.setFieldValue(namePath, undefined);
      } else {
        const fallback = lastValuesRef.current[key];
        const nextValue = typeof fallback === 'number' ? fallback : PARAM_DEFAULTS[key];
        lastValuesRef.current[key] = nextValue;
        newValue = nextValue;
        form.setFieldValue(namePath, nextValue);
      }

      // Save changes immediately - manually construct config object to ensure latest values are used
      setUpdating(true);
      const currentValues = form.getFieldsValue();
      const prevParams = (currentValues.params ?? {}) as Record<ParamKey, number | undefined>;
      const currentParams: Record<ParamKey, number | undefined> = { ...prevParams };

      if (newValue === undefined) {
        // Explicitly delete the property instead of setting it to undefined
        // This ensures the Form state stays in sync
        delete currentParams[key];
        // Use null as a disabled marker (the database preserves null, and the frontend uses it to determine checkbox state)
        currentParams[key] = null as any;
      } else {
        currentParams[key] = newValue;
      }

      const updatedConfig = {
        ...currentValues,
        params: currentParams,
      };

      await updateAgentConfig(updatedConfig);
      setUpdating(false);
    },
    [form, setUpdating, updateAgentConfig],
  );

  // Use useMemo to ensure the debounce function is only created once
  const handleValuesChange = useCallback(
    debounce(async (values) => {
      setUpdating(true);
      await updateAgentConfig(values);
      setUpdating(false);
    }, 500),
    [updateAgentConfig, setUpdating],
  );

  const baseItems: FormItemProps[] = (Object.keys(PARAM_CONFIG) as ParamKey[]).map((key) => {
    const meta = PARAM_CONFIG[key];
    const Component = meta.Component;
    const enabled = enabledMap[key];

    return {
      children: (
        <ParamControlWrapper
          Component={Component}
          checked={enabled}
          disabled={!enabled}
          styles={styles}
          value={form.getFieldValue(PARAM_NAME_MAP[key])}
          onToggle={(checked) => handleToggle(key, checked)}
        />
      ),
      label: (
        <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
          {t(meta.labelKey)}
          <InfoTooltip title={t(meta.descKey)} />
        </Flexbox>
      ),
      name: PARAM_NAME_MAP[key],
      tag: meta.tag,
    } satisfies FormItemProps;
  });

  // MaxTokens items
  const maxTokensItems: FormItemProps[] = [
    {
      children: <Switch />,
      label: (
        <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
          {t('settingModel.enableMaxTokens.title')}
        </Flexbox>
      ),
      name: ['chatConfig', 'enableMaxTokens'],
      tag: 'max_tokens',
      valuePropName: 'checked',
    },
    ...(enableMaxTokens
      ? [
          {
            children: <SliderWithInput unlimitedInput max={32_000} min={0} step={100} />,
            label: (
              <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
                {t('settingModel.maxTokens.title')}
                <InfoTooltip title={t('settingModel.maxTokens.desc')} />
              </Flexbox>
            ),
            name: ['params', 'max_tokens'],
            tag: 'max_tokens',
          } satisfies FormItemProps,
        ]
      : []),
  ];

  // Context Compression items
  const contextCompressionItems: FormItemProps[] = [
    {
      children: <Switch />,
      label: (
        <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
          {t('settingModel.enableContextCompression.title')}
          <InfoTooltip title={t('settingModel.enableContextCompression.desc')} />
        </Flexbox>
      ),
      name: ['chatConfig', 'enableContextCompression'],
      tag: 'compression',
      valuePropName: 'checked',
    },
  ];

  // History Count items
  const historyCountItems: FormItemProps[] = [
    {
      children: <Switch />,
      label: (
        <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
          {t('settingChat.enableHistoryCount.title')}
          <InfoTooltip title={t('settingChat.historyCount.desc')} />
        </Flexbox>
      ),
      name: ['chatConfig', 'enableHistoryCount'],
      tag: 'history',
      valuePropName: 'checked',
    },
    ...(enableHistoryCount
      ? [
          {
            children: (
              <SliderWithInput
                max={20}
                min={0}
                step={1}
                unlimitedInput={true}
                styles={{
                  input: {
                    maxWidth: 64,
                  },
                }}
              />
            ),
            label: (
              <Flexbox horizontal align={'center'} className={styles.label} gap={8}>
                {t('settingChat.historyCount.title')}
                <InfoTooltip title={t('settingChat.historyCount.desc')} />
              </Flexbox>
            ),
            name: ['chatConfig', 'historyCount'],
            tag: 'history',
          } satisfies FormItemProps,
        ]
      : []),
  ];

  const allItems = [
    ...baseItems,
    ...maxTokensItems,
    ...contextCompressionItems,
    ...historyCountItems,
  ];

  return (
    <Form
      form={form}
      initialValues={config}
      itemMinWidth={220}
      itemsType={'flat'}
      items={
        mobile
          ? allItems
          : allItems.map(({ tag, ...item }) => ({
              ...item,
              desc: <Tag size={'small'}>{tag}</Tag>,
            }))
      }
      styles={{
        group: {
          background: 'transparent',
          paddingBottom: 12,
        },
      }}
      onValuesChange={handleValuesChange}
    />
  );
});

export default Controls;
