import { isDesktop } from '@lobechat/const';
import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { type LobeToolCustomPlugin } from '@lobechat/types';
import { Button, Drawer, Flexbox } from '@lobehub/ui';
import { App, Form, Popconfirm } from 'antd';
import { useResponsive } from 'antd-style';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MCPManifestForm from './MCPManifestForm';
import PluginPreview from './PluginPreview';

interface DevModalProps {
  /** Enable the connector-backed OAuth auth type in the MCP form (see MCPManifestForm). */
  enableOAuth?: boolean;
  mode?: 'edit' | 'create';
  onDelete?: () => void;
  onOpenChange: (open: boolean) => void;
  onSave?: (
    value: LobeToolCustomPlugin,
    ctx?: { oauthPopup?: Window | null },
  ) => Promise<void> | void;
  onValueChange?: (value: Partial<LobeToolCustomPlugin>) => void;
  open?: boolean;
  value?: LobeToolCustomPlugin;
}

const DevModal = memo<DevModalProps>(
  ({
    open,
    mode = 'create',
    value,
    onValueChange,
    onSave,
    onOpenChange,
    onDelete,
    enableOAuth,
  }) => {
    const isEditMode = mode === 'edit';
    const { t } = useTranslation('plugin');
    const { message } = App.useApp();

    const [submitting, setSubmitting] = useState(false);

    const { mobile } = useResponsive();
    const [form] = Form.useForm();
    const authType = Form.useWatch(['customParams', 'mcp', 'auth', 'type'], form);

    // Seed the form once per modal open, waiting for `value` to arrive (it may
    // be undefined initially while edit-mode credentials are being fetched).
    const seededRef = useRef(false);
    useEffect(() => {
      if (!open) {
        seededRef.current = false;
        return;
      }
      if (value !== undefined && !seededRef.current) {
        form.setFieldsValue(value);
        seededRef.current = true;
      }
    }, [open, value]);

    const doSave = async (values: LobeToolCustomPlugin, ctx?: { oauthPopup?: Window | null }) => {
      if (!onSave) {
        message.success(t(isEditMode ? 'dev.updateSuccess' : 'dev.saveSuccess'));
        onOpenChange(false);
        return;
      }
      setSubmitting(true);
      try {
        await onSave(values, ctx);
        message.success(t(isEditMode ? 'dev.updateSuccess' : 'dev.saveSuccess'));
        onOpenChange(false);
      } catch (error) {
        console.error('[DevModal] Install failed:', error);
        message.error(t('dev.saveError'));
      } finally {
        setSubmitting(false);
      }
    };

    // OAuth needs window.open within the user-gesture tick (browsers block it
    // after an async boundary). Open a blank popup synchronously here, validate,
    // then hand it to onSave which navigates it to the authorize URL. Shared by
    // the footer save button and the in-form "Authorize" button.
    const runOAuthFlow = async () => {
      const popup = window.open('about:blank', 'lobe-connector-oauth', 'width=600,height=720');
      try {
        const values = (await form.validateFields()) as LobeToolCustomPlugin;
        await doSave(values, { oauthPopup: popup });
      } catch {
        popup?.close();
      }
    };

    const handlePrimaryClick = () => {
      if (enableOAuth && authType === 'oauth2') return runOAuthFlow();
      form.submit();
    };

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
            onClick={handlePrimaryClick}
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
          await doSave(info.values as LobeToolCustomPlugin);
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
              <MCPManifestForm
                enableOAuth={enableOAuth}
                form={form}
                isEditMode={isEditMode}
                onAuthorizeOAuth={runOAuthFlow}
              />
            </Flexbox>
            <PluginPreview form={form} />
          </Flexbox>
        </Drawer>
      </Form.Provider>
    );
  },
);

export default DevModal;
