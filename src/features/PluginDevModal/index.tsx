import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Alert, Button, Drawer, Flexbox, Icon, Segmented, Tag } from '@lobehub/ui';
import { App, Form, Popconfirm } from 'antd';
import { useResponsive } from 'antd-style';
import { MoveUpRight } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { WIKI_PLUGIN_GUIDE } from '@/const/url';
import { isDesktop } from '@/const/version';
import { type LobeToolCustomPlugin } from '@/types/tool/plugin';

import MCPManifestForm from './MCPManifestForm';
import PluginPreview from './PluginPreview';
import UrlManifestForm from './UrlManifestForm';

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
    const [configMode, setConfigMode] = useState<'url' | 'mcp'>('mcp');
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
      <Flexbox flex={1} gap={12} horizontal justify={'space-between'}>
        {isEditMode ? (
          <Popconfirm
            arrow={false}
            cancelText={t('cancel', { ns: 'common' })}
            okButtonProps={{
              danger: true,
              type: 'primary',
            }}
            okText={t('ok', { ns: 'common' })}
            onConfirm={() => {
              onDelete?.();
              message.success(t('dev.deleteSuccess'));
            }}
            placement={'topLeft'}
            title={t('dev.confirmDeleteDevPlugin')}
          >
            <Button danger style={buttonStyle}>
              {t('delete', { ns: 'common' })}
            </Button>
          </Popconfirm>
        ) : (
          <div />
        )}
        <Flexbox gap={12} horizontal>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
            style={buttonStyle}
          >
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            loading={submitting}
            onClick={() => {
              form.submit();
            }}
            style={buttonStyle}
            type={'primary'}
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
          containerMaxWidth={'auto'}
          destroyOnHidden
          footer={footer}
          height={isDesktop ? `calc(100vh - ${TITLE_BAR_HEIGHT}px)` : '100vh'}
          onClose={(e) => {
            e.stopPropagation();
            onOpenChange(false);
          }}
          open={open}
          placement={'bottom'}
          push={false}
          styles={{
            body: {
              padding: 0,
            },
            bodyContent: {
              height: '100%',
            },
          }}
          title={t(isEditMode ? 'dev.title.edit' : 'dev.title.create')}
          width={mobile ? '100%' : 800}
        >
          <Flexbox
            gap={0}
            height={'100%'}
            horizontal
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Flexbox flex={3} gap={16} padding={24} style={{ overflowY: 'auto' }}>
              <Segmented
                block
                onChange={(e) => {
                  setConfigMode(e as 'url' | 'mcp');
                }}
                options={[
                  {
                    label: (
                      <Flexbox align={'center'} gap={4} horizontal justify={'center'}>
                        {t('dev.manifest.mode.mcp')}
                        <div>
                          <Tag color={'warning'} variant={'filled'}>
                            {t('dev.manifest.mode.mcpExp')}
                          </Tag>
                        </div>
                      </Flexbox>
                    ),
                    value: 'mcp',
                  },
                  {
                    label: t('dev.manifest.mode.url'),
                    value: 'url',
                  },
                ]}
                value={configMode}
                variant={'filled'}
              />

              {configMode === 'url' && (
                <>
                  <Alert
                    showIcon
                    title={
                      <Trans i18nKey={'dev.modalDesc'} ns={'plugin'}>
                        添加自定义插件后，可用于插件开发验证，也可直接在会话中使用。插件开发文档请参考：
                        <a
                          href={WIKI_PLUGIN_GUIDE}
                          rel="noreferrer"
                          style={{ paddingInline: 8 }}
                          target={'_blank'}
                        >
                          文档
                        </a>
                        <Icon icon={MoveUpRight} />
                      </Trans>
                    }
                    type={'info'}
                  />
                  <UrlManifestForm form={form} isEditMode={isEditMode} />
                </>
              )}
              {configMode === 'mcp' && <MCPManifestForm form={form} isEditMode={isEditMode} />}
            </Flexbox>
            <PluginPreview form={form} />
          </Flexbox>
        </Drawer>
      </Form.Provider>
    );
  },
);

export default DevModal;
