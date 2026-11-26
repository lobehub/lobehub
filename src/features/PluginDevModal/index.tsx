import { type LobeToolCustomPlugin } from '@lobechat/types';
import { Button, confirmModal, Flexbox, Modal, toast } from '@lobehub/ui';
import { useForm, useWatch } from '@lobehub/ui/form';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { openConnectorOAuthPopup } from '@/utils/connectorOAuth';

import MCPManifestForm from './MCPManifestForm';
import {
  AUTHORIZE_ALWAYS,
  type DevModalOAuthFields,
  type DevModalOAuthPlan,
  planOAuthSave,
} from './oauthSavePlan';
import { pruneHiddenFields } from './pruneHiddenFields';
import { getSaveErrorToast } from './saveErrorToast';

const INITIAL_VALUES = {
  customParams: { mcp: { auth: { type: 'none' }, type: 'http' } },
} as LobeToolCustomPlugin;

export type { DevModalOAuthFields, DevModalOAuthPlan } from './oauthSavePlan';

interface DevModalProps {
  /** Let a device-run server be bound to one device (connectors only, see MCPManifestForm). */
  enableDeviceBinding?: boolean;
  /** Enable the connector-backed OAuth auth type in the MCP form (see MCPManifestForm). */
  enableOAuth?: boolean;
  /**
   * For the OAuth fields as they stand: whether saving authorizes, and what to
   * tell the user about the connected accounts. Without it every OAuth save
   * authorizes (creating a connector has nothing to keep).
   */
  getOAuthPlan?: (fields: DevModalOAuthFields) => DevModalOAuthPlan;
  mode?: 'edit' | 'create';
  onDelete?: () => void;
  onOpenChange: (open: boolean) => void;
  onSave?: (
    value: LobeToolCustomPlugin,
    ctx?: { oauthPopup?: Window | null },
  ) => Promise<void> | void;
  onValueChange?: (value: Partial<LobeToolCustomPlugin>) => void;
  open?: boolean;
  /** The edited connector is private to its creator (see MCPManifestForm). */
  privateConnector?: boolean;
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
    enableDeviceBinding,
    enableOAuth,
    getOAuthPlan,
    privateConnector,
  }) => {
    const isEditMode = mode === 'edit';
    const { t } = useTranslation('plugin');

    const [submitting, setSubmitting] = useState(false);
    const [saveError, setSaveError] = useState<{ detail?: string; summary: string } | null>(null);

    const form = useForm<LobeToolCustomPlugin>({
      initialValues: INITIAL_VALUES,
      onSubmit: async (values) => {
        await doSave(values);
      },
      onValuesChange: (_, values) => {
        setSaveError(null);
        onValueChange?.(values);
      },
    });
    const serverUrl = useWatch(form, 'customParams.mcp.url');
    const clientId = useWatch(form, 'customParams.mcp.auth.clientId');
    const clientSecret = useWatch(form, 'customParams.mcp.auth.clientSecret');
    const oauthPlan =
      getOAuthPlan?.({ clientId, clientSecret, url: serverUrl }) ?? AUTHORIZE_ALWAYS;

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
      setSaveError(null);
      try {
        await onSave(pruneHiddenFields(values), ctx);
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
        setSaveError({ detail: description, summary: title });
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
      setSaveError(null);
      const popup = openConnectorOAuthPopup();
      if (popup === null) {
        setSaveError({ summary: t('dev.oauthError.blocked') });
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
      // Decided on the values being saved, so the popup opens exactly when the
      // save handler will authorize (it applies the same plan).
      if (planOAuthSave({ enableOAuth, getOAuthPlan, values: form.getValues() }).authorize)
        return runOAuthFlow();
      form.submit();
    };

    useEffect(() => {
      if (mode === 'create' && !open) form.reset(INITIAL_VALUES);
    }, [open]);

    const footer = (
      <Flexbox flex={1} gap={8}>
        {saveError && (
          <InlineErrorText detail={saveError.detail}>{saveError.summary}</InlineErrorText>
        )}
        <Flexbox horizontal gap={12} justify={'space-between'}>
          {isEditMode ? (
            <Button
              danger
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
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button loading={submitting} type={'primary'} onClick={handlePrimaryClick}>
              {t(isEditMode ? 'dev.update' : 'dev.addConnector')}
            </Button>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );

    // A centered dialog, not a full-height sheet: the form is a handful of
    // fields with the advanced ones folded, so it keeps the page it was opened
    // from in view. The body scrolls; the footer stays put.
    return (
      <Modal
        footer={footer}
        keyboard={!submitting}
        maskClosable={!submitting}
        open={open}
        title={t(isEditMode ? 'dev.title.connectorSettings' : 'dev.title.createConnector')}
        width={640}
        styles={{
          body: { maxHeight: 'calc(100dvh - 200px)', overflowY: 'auto' },
        }}
        onCancel={() => {
          onOpenChange(false);
        }}
      >
        {/* React events bubble through the portal: keep form clicks away from
            the row or menu that opened the dialog. */}
        <Flexbox
          gap={16}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <MCPManifestForm
            enableDeviceBinding={enableDeviceBinding}
            enableOAuth={enableOAuth}
            form={form}
            isEditMode={isEditMode}
            oauthNotice={oauthPlan.notice}
            privateConnector={privateConnector}
            onAuthorizeOAuth={oauthPlan.authorize ? runOAuthFlow : undefined}
          />
        </Flexbox>
      </Modal>
    );
  },
);

export default DevModal;
