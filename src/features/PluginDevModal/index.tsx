import { isDesktop } from '@lobechat/const';
import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { type LobeToolCustomPlugin } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal, Drawer, toast } from '@lobehub/ui/base-ui';
import { useForm, useWatch } from '@lobehub/ui/base-ui/form';
import { useResponsive } from 'antd-style';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openConnectorOAuthPopup } from '@/utils/connectorOAuth';

import MCPManifestForm from './MCPManifestForm';
import PluginPreview from './PluginPreview';
import { getSaveErrorToast } from './saveErrorToast';

const INITIAL_VALUES = {
  customParams: { mcp: { auth: { type: 'none' }, type: 'http' } },
} as LobeToolCustomPlugin;

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

    const [submitting, setSubmitting] = useState(false);

    const { mobile } = useResponsive();
    const form = useForm<LobeToolCustomPlugin>({
      initialValues: INITIAL_VALUES,
      onSubmit: async (values) => {
        await doSave(values);
      },
      onValuesChange: (_, values) => {
        onValueChange?.(values);
      },
    });
    const authType = useWatch(form, 'customParams.mcp.auth.type');

    // Seed the form once per modal open, waiting for `value` to arrive (it may
    // be undefined initially while edit-mode credentials are being fetched).
    const seededRef = useRef(false);
    useEffect(() => {
      if (!open) {
        seededRef.current = false;
        return;
      }
      if (value !== undefined && !seededRef.current) {
        form.setValues(value);
        seededRef.current = true;
      }
    }, [open, value]);

    const doSave = async (values: LobeToolCustomPlugin, ctx?: { oauthPopup?: Window | null }) => {
      if (!onSave) {
        toast.success(t(isEditMode ? 'dev.updateSuccess' : 'dev.saveSuccess'));
        onOpenChange(false);
        return;
      }
      setSubmitting(true);
      try {
        await onSave(values, ctx);
        toast.success(t(isEditMode ? 'dev.updateSuccess' : 'dev.saveSuccess'));
        onOpenChange(false);
      } catch (error) {
        console.error('[DevModal] Install failed:', error);
        const { description, titleKey } = getSaveErrorToast(error, Boolean(ctx));
        const title =
          titleKey === 'dev.permissionDenied'
            ? t(
                'dev.permissionDenied',
                'You are not allowed to modify this connector — only the creator or a workspace owner can',
              )
            : t(titleKey as never);
        toast.error(description ? { description, title } : title);
      } finally {
        ctx?.oauthPopup?.close();
        setSubmitting(false);
      }
    };

    // Web OAuth needs window.open within the user-gesture tick (browsers block it
    // after an async boundary). Open a blank popup synchronously here, validate,
    // then hand it to onSave. Desktop opens a native window via IPC instead. Shared by
    // the footer save button and the in-form "Authorize" button.
    const runOAuthFlow = async () => {
      if (submitting) return;
      const popup = openConnectorOAuthPopup();
      if (popup === null) {
        toast.error(t('dev.oauthError.blocked'));
        return;
      }
      const { valid } = await form.validate();
      if (!valid) {
        popup?.close();
        return;
      }
      await doSave(form.getValues(), { oauthPopup: popup });
    };

    const handlePrimaryClick = () => {
      if (enableOAuth && authType === 'oauth2') return runOAuthFlow();
      form.submit();
    };

    useEffect(() => {
      if (mode === 'create' && !open) form.reset(INITIAL_VALUES);
    }, [open]);

    const buttonStyle = mobile ? { flex: 1 } : { margin: 0 };

    const footer = (
      <Flexbox horizontal flex={1} gap={12} justify={'space-between'}>
        {isEditMode ? (
          <Button
            danger
            style={buttonStyle}
            onClick={() =>
              confirmModal({
                cancelText: t('cancel', { ns: 'common' }),
                okButtonProps: { danger: true },
                okText: t('ok', { ns: 'common' }),
                onOk: () => {
                  onDelete?.();
                  toast.success(t('dev.deleteSuccess'));
                },
                content: t('dev.confirmDeleteDevPlugin'),
                title: t('delete', { ns: 'common' }),
              })
            }
          >
            {t('delete', { ns: 'common' })}
          </Button>
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
      <Drawer
        containerMaxWidth={'auto'}
        footer={footer}
        height={isDesktop ? `calc(100vh - ${TITLE_BAR_HEIGHT}px)` : '100vh'}
        open={open}
        placement={'bottom'}
        push={false}
        title={t(isEditMode ? 'dev.title.skillSettings' : 'dev.title.create')}
        width={mobile ? '100%' : 800}
        styles={{
          bodyContent: {
            height: '100%',
            padding: 0,
          },
        }}
        onClose={() => {
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
    );
  },
);

export default DevModal;
