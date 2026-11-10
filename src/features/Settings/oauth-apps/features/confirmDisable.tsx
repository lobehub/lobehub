import { confirmModal } from '@lobehub/ui';
import { t } from 'i18next';

/**
 * Disabling makes the provider treat the client as unknown: new sign-ins and
 * token refreshes fail for every user of the app. That is a wider blast radius
 * than rotating the secret, so it gets the same explicit confirmation.
 */
export const confirmDisableOAuthApp = (onOk: () => Promise<unknown>) =>
  confirmModal({
    cancelText: t('cancel', { ns: 'common' }),
    content: t('oauthApp.disableConfirm.content', { ns: 'auth' }),
    okButtonProps: { danger: true },
    okText: t('oauthApp.disableConfirm.ok', { ns: 'auth' }),
    onOk: async () => {
      await onOk();
    },
    title: t('oauthApp.disableConfirm.title', { ns: 'auth' }),
  });
