import { Form, type FormItemProps, Tag } from '@lobehub/ui';
import { Form as AntdForm, Checkbox } from 'antd';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { debounce } from 'lodash-es';
import { memo, useCallback, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import InfoTooltip from '@/components/InfoTooltip';
import {
  FrequencyPenalty,
  PresencePenalty,
  Temperature,
  TopP,
} from '@/features/ModelParamsControl';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';

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

const useStyles = createStyles(({ css, token }) => ({
  checkbox: css`
    .ant-checkbox-inner {
      border-radius: 4px;
    }

    &:hover .ant-checkbox-inner {
      border-color: ${token.colorPrimary};
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
  Component: ComponentType<any>;
  checked: boolean;
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
          onChange={(e) => {
            e.stopPropagation();
            onToggle(e.target.checked);
          }}
        />
        <div style={{ flex: 1 }}>
          <Component disabled={disabled} onChange={onChange} value={value} />
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

const Controls = memo<ControlsProps>(({ setUpdating }) => {
  const { t } = useTranslation('setting');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const updateAgentConfig = useAgentStore((s) => s.updateAgentConfig);
  const { styles } = useStyles();

  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const [form] = Form.useForm();

  const { frequency_penalty, presence_penalty, temperature, top_p } = config.params ?? {};

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

      // 立即保存变更 - 手动构造配置对象确保使用最新值
      setUpdating(true);
      const currentValues = form.getFieldsValue();
      const prevParams = (currentValues.params ?? {}) as Record<ParamKey, number | undefined>;
      const currentParams: Record<ParamKey, number | undefined> = { ...prevParams };

      if (newValue === undefined) {
        // 显式删除该属性，而不是设置为 undefined
        // 这样可以确保 Form 表单状态同步
        delete currentParams[key];
        // 使用 null 作为禁用标记（数据库会保留 null，前端据此判断复选框状态）
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

  // 使用 useMemo 确保防抖函数只创建一次
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
          onToggle={(checked) => handleToggle(key, checked)}
          styles={styles}
        />
      ),
      label: (
        <Flexbox align={'center'} className={styles.label} gap={8} horizontal>
          {t(meta.labelKey)}
          <InfoTooltip title={t(meta.descKey)} />
        </Flexbox>
      ),
      name: PARAM_NAME_MAP[key],
      tag: meta.tag,
    } satisfies FormItemProps;
  });

  return (
    <Form
      form={form}
      initialValues={config}
      itemMinWidth={220}
      items={
        mobile
          ? baseItems
          : baseItems.map(({ tag, ...item }) => ({
              ...item,
              desc: <Tag size={'small'}>{tag}</Tag>,
            }))
      }
      itemsType={'flat'}
      onValuesChange={handleValuesChange}
      styles={{
        group: {
          background: 'transparent',
          paddingBottom: 12,
        },
      }}
    />
  );
});

export default Controls;
