import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { parse } from 'partial-json';
import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type DescriptionItem } from '@/components/Descriptions';
import Descriptions from '@/components/Descriptions';
import { useYamlArguments } from '@/hooks/useYamlArguments';
import { shinyTextStyles } from '@/styles';

const formatValue = (value: any): string => {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ');
  }

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ');
  }
  return String(value);
};

export interface ArgumentsProps {
  actions?: ReactNode;
  arguments?: string;
  loading?: boolean;
}

const Arguments = memo<ArgumentsProps>(({ arguments: args = '', loading, actions }) => {
  const { t } = useTranslation('plugin');

  const displayArgs = useMemo(() => {
    try {
      const obj = parse(args);
      if (Object.keys(obj).length === 0) return {};
      return obj;
    } catch {
      return args;
    }
  }, [args]);

  const yaml = useYamlArguments(args);

  let contentNode;

  if (typeof displayArgs === 'string') {
    contentNode = !!yaml && (
      <Highlighter language={'yaml'} showLanguage={false}>
        {yaml}
      </Highlighter>
    );
  } else if (Object.keys(displayArgs).length === 0) {
    contentNode = null;
  } else {
    const items: DescriptionItem[] = Object.entries(displayArgs).map(([key, value]) => ({
      copyable: true,
      key,
      label: key,
      value: formatValue(value),
    }));

    contentNode = (
      <Flexbox paddingBlock={4} paddingInline={16}>
        <Descriptions
          bordered={false}
          items={items}
          labelWidth={140}
          maxItemWidth={'100%'}
          classNames={{
            label: cx(loading && shinyTextStyles.shinyText),
          }}
          styles={{
            label: loading
              ? { color: `color-mix(in srgb, ${cssVar.colorText} 33%, transparent)` }
              : {},
          }}
        />
      </Flexbox>
    );
  }

  return (
    <>
      <Flexbox
        horizontal
        align={'center'}
        gap={4}
        justify={'space-between'}
        paddingBlock={8}
        paddingInline={16}
      >
        <Text>{t('arguments.title')}</Text>
        <Flexbox horizontal gap={4}>
          {actions}
        </Flexbox>
      </Flexbox>
      <Divider style={{ marginBlock: 0 }} />
      {contentNode}
    </>
  );
});

export default Arguments;
