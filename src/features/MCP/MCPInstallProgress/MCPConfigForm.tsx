import { Button, Flexbox, Form, Markdown } from '@lobehub/ui';
import { Form as AForm } from 'antd';
import { createStaticStyles } from 'antd-style';
import * as motion from 'motion/react-m';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ItemRender from '@/components/JSONSchemaConfig/ItemRender';
import { transformPluginSettings } from '@/features/PluginSettings';
import { useToolStore } from '@/store/tool';

interface MCPConfigFormProps {
  configSchema: any;
  identifier: string;
  onCancel?: () => void;
  onSubmit?: (config: Record<string, any>) => Promise<void>;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    margin-block-start: ${cssVar.marginXS};
    padding: ${cssVar.padding};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    background-color: ${cssVar.colorBgContainer};
  `,
  footer: css`
    display: flex;
    gap: ${cssVar.marginXS};
    justify-content: flex-end;

    margin-block-start: ${cssVar.margin};
    padding-block-start: ${cssVar.paddingXS};
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  markdown: css`
    p {
      color: ${cssVar.colorTextDescription};
    }
  `,
}));

const MCPConfigForm = memo<MCPConfigFormProps>(({ configSchema, identifier, onCancel }) => {
  const { t } = useTranslation(['plugin', 'common']);
  const [form] = AForm.useForm();
  const [loading, setLoading] = useState(false);

  const { installMCPPlugin } = useToolStore();

  const items = transformPluginSettings(configSchema);

  const handleSubmit = async (values: Record<string, any>) => {
    setLoading(true);
    try {
      await installMCPPlugin(identifier, { config: values, resume: true });
    } catch (error) {
      console.error('Config submission failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      // 默认行为：清理安装进度
      useToolStore.getState().updateMCPInstallProgress(identifier, undefined);
    }
  };

  return (
    <motion.div
      animate={{ y: 0 }}
      className={styles.container}
      initial={{ y: 8 }}
      transition={{ delay: 0.1, duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
    >
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        initial={{ opacity: 0, y: 4 }}
        transition={{ delay: 0.15, duration: 0.2 }}
      >
        <Flexbox gap={8}>
          <strong>{t('mcpInstall.configurationRequired')}</strong>
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            {t('mcpInstall.configurationDescription')}
          </span>
        </Flexbox>
      </motion.div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        initial={{ opacity: 0, y: 4 }}
        transition={{ delay: 0.2, duration: 0.2 }}
      >
        <Form
          form={form}
          gap={12}
          itemsType={'flat'}
          layout={'vertical'}
          variant={'borderless'}
          items={items
            .filter((item) => configSchema.required?.includes(item.name))
            .map((item) => ({
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
              rules: [{ required: true }],
              tag: item.tag,
              valuePropName: item.type === 'boolean' ? 'checked' : undefined,
            }))}
          onFinish={handleSubmit}
        />
      </motion.div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className={styles.footer}
        initial={{ opacity: 0, y: 4 }}
        transition={{ delay: 0.25, duration: 0.2 }}
      >
        <Button size="small" onClick={handleCancel}>
          {t('common:cancel')}
        </Button>
        <Button loading={loading} size="small" type="primary" onClick={() => form.submit()}>
          {t('mcpInstall.continueInstall')}
        </Button>
      </motion.div>
    </motion.div>
  );
});

export default MCPConfigForm;
