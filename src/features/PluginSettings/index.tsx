import { type PluginSchema } from '@lobehub/chat-plugin-sdk';
import { Form, Markdown } from '@lobehub/ui';
import { Form as AForm } from 'antd';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import ItemRender from '../../components/JSONSchemaConfig/ItemRender';

export const transformPluginSettings = (pluginSettings: PluginSchema) => {
  if (!pluginSettings?.properties) return [];

  return Object.entries(pluginSettings.properties).map(([name, i]) => ({
    desc: i.description,
    enum: i.enum,
    format: i.format,
    label: i.title || name,
    maximum: i.maximum,
    minimum: i.minimum,
    name,
    tag: name,
    type: i.type,
  }));
};

interface PluginSettingsConfigProps {
  id: string;
  schema: PluginSchema;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  markdown: css`
    p {
      color: ${cssVar.colorTextDescription};
    }
  `,
}));

const PluginSettingsConfig = memo<PluginSettingsConfigProps>(({ schema, id }) => {
  const [updatePluginSettings] = useToolStore((s) => [s.updatePluginSettings]);
  const pluginSetting = useToolStore(pluginSelectors.getPluginSettingsById(id), isEqual);

  const [form] = AForm.useForm();

  const items = transformPluginSettings(schema);

  return (
    <Form
      footer={<Form.SubmitFooter />}
      form={form}
      gap={16}
      initialValues={pluginSetting}
      itemsType={'flat'}
      layout={'vertical'}
      variant={'borderless'}
      items={items.map((item) => ({
        children: (
          <ItemRender
            enum={item.enum}
            format={item.format}
            maximum={item.maximum}
            minimum={item.minimum}
            type={item.type as any}
          />
        ),
        desc: item.desc && (
          <Markdown className={styles.markdown} variant={'chat'}>
            {item.desc as string}
          </Markdown>
        ),
        key: item.label,
        label: item.label,
        name: item.name,
        tag: item.tag,
        valuePropName: item.type === 'boolean' ? 'checked' : undefined,
      }))}
      onFinish={async (v) => {
        await updatePluginSettings(id, v);
      }}
    />
  );
});

export default PluginSettingsConfig;
