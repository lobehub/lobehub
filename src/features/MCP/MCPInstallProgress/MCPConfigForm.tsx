import { Button, Flexbox, Markdown } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import * as m from 'motion/react-m';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ItemRender from '@/components/JSONSchemaConfig/ItemRender';
import { transformPluginSettings } from '@/features/PluginSettings';
import { useToolStore } from '@/store/tool';

import moduleStyles from './MCPConfigForm.module.css';

interface MCPConfigFormProps {
  configSchema: any;
  identifier: string;
  onCancel?: () => void;
  onSubmit?: (config: Record<string, any>) => Promise<void>;
}

const styles = stylex.create({
  container: {
    marginBlockStart: cssVar.marginXS,
    padding: cssVar.padding,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  footer: {
    display: 'flex',
    gap: cssVar.marginXS,
    justifyContent: 'flex-end',
    marginBlockStart: cssVar.margin,
    paddingBlockStart: cssVar.paddingXS,
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
});

const MCPConfigForm = memo<MCPConfigFormProps>(({ configSchema, identifier, onCancel }) => {
  const { t } = useTranslation(['plugin', 'common']);
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

  const form = useForm<Record<string, any>>({ onSubmit: handleSubmit });

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      // Default behavior: clear installation progress
      useToolStore.getState().updateMCPInstallProgress(identifier, undefined);
    }
  };

  return (
    <m.div
      animate={{ y: 0 }}
      className={stylex.props(styles.container).className}
      initial={{ y: 8 }}
      transition={{ delay: 0.1, duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
    >
      <m.div
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
      </m.div>

      <m.div
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
                <Markdown className={moduleStyles.markdown} variant={'chat'}>
                  {item.desc as string}
                </Markdown>
              ),
              label: item.label,
              name: item.name,
              required: true,
              tag: item.tag,
            }))}
        />
      </m.div>

      <m.div
        animate={{ opacity: 1, y: 0 }}
        className={stylex.props(styles.footer).className}
        initial={{ opacity: 0, y: 4 }}
        transition={{ delay: 0.25, duration: 0.2 }}
      >
        <Button size="small" onClick={handleCancel}>
          {t('common:cancel')}
        </Button>
        <Button loading={loading} size="small" type="primary" onClick={() => form.submit()}>
          {t('mcpInstall.continueInstall')}
        </Button>
      </m.div>
    </m.div>
  );
});

export default MCPConfigForm;
