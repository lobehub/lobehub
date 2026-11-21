import { type WebhookEndpointItem } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useDeveloperWebhookStore } from '@/store/developerWebhook';

import { resolveTestOutcome } from '../status';
import { showWebhookSecretModal } from './SecretModal';
import { createWebhookFormModal } from './WebhookFormModal';

const trpcCode = (error: unknown) =>
  (error as { data?: { code?: unknown } } | null)?.data?.code as string | undefined;

const actions = () => useDeveloperWebhookStore.getState();

/**
 * Every row and header action of the webhook list. Each one gives its own
 * feedback (toast, modal or inline error), so callers only wire buttons.
 */
export const useWebhookActions = () => {
  const { t } = useTranslation(['setting', 'common']);
  const failed = () => toast.error(t('operationFailed', { ns: 'common' }));

  const create = () =>
    createWebhookFormModal({
      onSubmit: async (values) => {
        try {
          const created = await actions().createWebhook(values);
          showWebhookSecretModal({ reason: 'created', secret: created.secret });
        } catch (error) {
          throw new Error(
            trpcCode(error) === 'CONFLICT'
              ? t('webhook.form.limitReached')
              : t('operationFailed', { ns: 'common' }),
            { cause: error },
          );
        }
      },
    });

  const edit = (endpoint: WebhookEndpointItem) =>
    createWebhookFormModal({
      initialValues: {
        description: endpoint.description ?? '',
        enabled: endpoint.enabled,
        events: endpoint.events,
        url: endpoint.url,
      },
      onSubmit: async (values) => {
        try {
          await actions().updateWebhook(endpoint.id, values);
        } catch {
          throw new Error(t('operationFailed', { ns: 'common' }));
        }
      },
    });

  const setEnabled = async (endpoint: WebhookEndpointItem, enabled: boolean) => {
    try {
      await actions().setWebhookEnabled(endpoint.id, enabled);
    } catch {
      failed();
    }
  };

  /** Sends one test event and reports the receiver's answer. */
  const test = async (endpoint: WebhookEndpointItem) => {
    try {
      const outcome = resolveTestOutcome(await actions().testWebhook(endpoint.id));
      const description =
        outcome.responseStatus === null
          ? t('webhook.test.noResponse', { error: outcome.error ?? '--' })
          : t('webhook.test.result', {
              duration: outcome.durationMs ?? '--',
              status: outcome.responseStatus,
            });

      if (outcome.ok) toast.success({ description, title: t('webhook.test.success') });
      else toast.error({ description, title: t('webhook.test.failed') });
    } catch {
      failed();
    }
  };

  const rotateSecret = (endpoint: WebhookEndpointItem) =>
    confirmModal({
      content: t('webhook.rotate.content'),
      okButtonProps: { danger: true },
      okText: t('webhook.rotate.ok'),
      onOk: async () => {
        try {
          const secret = await actions().rotateSecret(endpoint.id);
          showWebhookSecretModal({ reason: 'rotated', secret });
        } catch {
          failed();
        }
      },
      title: t('webhook.rotate.title'),
    });

  const remove = (endpoint: WebhookEndpointItem) =>
    confirmModal({
      content: t('webhook.delete.content', { url: endpoint.url }),
      okButtonProps: { danger: true },
      okText: t('webhook.delete.ok'),
      onOk: async () => {
        try {
          await actions().deleteWebhook(endpoint.id);
          toast.success(t('webhook.delete.success'));
        } catch {
          failed();
        }
      },
      title: t('webhook.delete.title'),
    });

  return { create, edit, remove, rotateSecret, setEnabled, test };
};
