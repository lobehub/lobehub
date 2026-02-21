import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Button, Drawer, Flexbox, Segmented, Tag } from '@lobehub/ui';
import { App, Form, Popconfirm } from 'antd';
import { useResponsive } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { type LobeToolCustomPlugin } from '@/types/tool/plugin';

import MCPManifestForm from './MCPManifestForm';
import PluginPreview from './PluginPreview';

interface DevModalProps {
  mode?: 'edit' | 'create';
  onDelete?: () => void;
  onOpenChange: (open: boolean) => void;
  onSave?: (value: LobeToolCustomPlugin) => Promise<void> | void;
  onValueChange?: (value: Partial<LobeToolCustomPlugin>) => void;
  open?: boolean;
  value?: LobeToolCustomPlugin;
}

const DevModal = memo<DevModalProps>(
  ({ open, mode = 'create', value, onValueChange, onSave, onOpenChange, onDelete }) => {
    const isEditMode = mode === 'edit';
    const [configMode, setConfigMode] = useState<'mcp' | 'claude'>('mcp');
    const { t } = useTranslation('plugin');
    const { message } = App.useApp();

    const [submitting, setSubmitting] = useState(false);

    const { mobile } = useResponsive();
    const [form] = Form.useForm();
    useEffect(() => {
      form.setFieldsValue(value);
    }, []);

    useEffect(() => {
      if (mode === 'create' && !open) form.resetFields();
    }, [open]);

    const buttonStyle = mobile ? { flex: 1 } : { margin: 0 };

    const footer = (
      <Flexbox horizontal flex={1} gap={12} justify={'space-between'}>
        {isEditMode ? (
          <Popconfirm
            arrow={false}
            cancelText={t('cancel', { ns: 'common' })}
            okText={t('ok', { ns: 'common' })}
            placement={'topLeft'}
            title={t('dev.confirmDeleteDevPlugin')}
            okButtonProps={{
              danger: true,
              type: 'primary',
            }}
            onConfirm={() => {
              onDelete?.();
              message.success(t('dev.deleteSuccess'));
            }}
          >
            <Button danger style={buttonStyle}>
              {t('delete', { ns: 'common' })}
            </Button>
          </Popconfirm>
        ) : (
          <div />
        )}
        <Flexbox horizontal gap={12}>
          <Button
            style={buttonStyle}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            loading={submitting}
            style={buttonStyle}
            type={'primary'}
            onClick={() => {
              form.submit();
            }}
          >
            {t(isEditMode ? 'dev.update' : 'dev.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    );

    return (
      <Form.Provider
        onFormChange={() => {
          onValueChange?.(form.getFieldsValue());
        }}
        onFormFinish={async (_, info) => {
          if (onSave) {
            setSubmitting(true);

            await onSave?.(info.values as LobeToolCustomPlugin);
            setSubmitting(false);
          }
          message.success(t(isEditMode ? 'dev.updateSuccess' : 'dev.saveSuccess'));
          onOpenChange(false);
        }}
      >
        <Drawer
          destroyOnHidden
          containerMaxWidth={'auto'}
          footer={footer}
          height={isDesktop ? `calc(100vh - ${TITLE_BAR_HEIGHT}px)` : '100vh'}
          open={open}
          placement={'bottom'}
          push={false}
          title={t(isEditMode ? 'dev.title.skillSettings' : 'dev.title.create')}
          width={mobile ? '100%' : 800}
          styles={{
            body: {
              padding: 0,
            },
            bodyContent: {
              height: '100%',
            },
          }}
          onClose={(e) => {
            e.stopPropagation();
            onOpenChange(false);
          }}
        >
          <Flexbox
            horizontal
            gap={0}
            height={'100%'}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Flexbox flex={3} gap={16} padding={24} style={{ overflowY: 'auto' }}>
              <Segmented
                block
                value={configMode}
                variant={'filled'}
                options={[
                  {
                    label: t('dev.manifest.mode.mcp'),
                    value: 'mcp',
                  },
                  {
                    disabled: true,
                    label: (
                      <Flexbox horizontal align={'center'} gap={4} justify={'center'}>
                        {t('dev.manifest.mode.claude')}
                        <div>
                          <Tag variant={'filled'}>{t('dev.manifest.mode.claudeWip')}</Tag>
                        </div>
                      </Flexbox>
                    ),
                    value: 'claude',
                  },
                ]}
                onChange={(e) => {
                  if (e === 'claude') return; // Claude Skill is disabled
                  setConfigMode(e as 'mcp' | 'claude');
                }}
              />

              <MCPManifestForm form={form} isEditMode={isEditMode} />
            </Flexbox>
            <PluginPreview form={form} />
          </Flexbox>
        </Drawer>
      </Form.Provider>
    );
  },
);

export default DevModal;
