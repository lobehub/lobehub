'use client';

import { Flexbox, Form, Highlighter } from '@lobehub/ui';
import { Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { snakeCase } from 'es-toolkit/compat';
import { ListRestartIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { DEFAULT_FEATURE_FLAGS } from '@/config/featureFlags';

import Header from '../features/Header';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    * {
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
    }
    .${prefixCls}-form-item {
      padding-block: 4px !important;
    }
  `,
}));

const FeatureFlagForm = memo<{ flags: any }>(({ flags }) => {
  const [data, setData] = useState(flags);
  const [form] = Form.useForm();

  const output = useMemo(
    () =>
      Object.entries(data).map(([key, value]) => {
        const flag = snakeCase(key);
        // @ts-ignore
        if (DEFAULT_FEATURE_FLAGS[flag] === value) return false;
        if (value === true) return `+${flag}`;
        return `-${flag}`;
      }),
    [data],
  );

  return (
    <>
      <Header
        actions={[
          {
            icon: ListRestartIcon,
            onClick: () => {
              form.resetFields();
              setData(flags);
            },
            title: 'Reset',
          },
        ]}
        title={'Feature Flag Env'}
      />
      <Flexbox
        className={styles.container}
        height={'100%'}
        paddingInline={16}
        style={{ overflow: 'auto', position: 'relative' }}
        width={'100%'}
      >
        <Form
          form={form}
          initialValues={flags}
          itemMinWidth={'max(75%,240px)'}
          items={Object.keys(flags).map((key) => {
            return {
              children: <Switch size={'small'} />,
              label: snakeCase(key),
              minWidth: undefined,
              name: key,
              valuePropName: 'checked',
            };
          })}
          itemsType={'flat'}
          onValuesChange={(_, v) => setData(v)}
          variant={'borderless'}
        />
      </Flexbox>
      <Highlighter
        language={'env'}
        style={{ flex: 'none', fontSize: 12 }}
        wrap
      >{`FEATURE_FLAGS="${output.filter(Boolean).join(',')}"`}</Highlighter>
    </>
  );
});

export default FeatureFlagForm;
