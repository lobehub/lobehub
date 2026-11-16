import { confirmModal, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { refreshConnectorManagePolicy } from '@/services/connectorManagePolicy';
import { useToolStore } from '@/store/tool';
import {
  type ConnectorAccountFlowResult,
  type ConnectorLinkSummary,
  connectorSelectors,
  type ConnectorWithTools,
  isConnectorLinkNameConflict,
} from '@/store/tool/slices/connector';
import { ConnectorOAuthError, openConnectorOAuthPopup } from '@/utils/connectorOAuth';

import {
  formatAccountErrorReason,
  isDismissedAuthorization,
  isPermissionRejection,
} from './accountFlowError';
import { type AccountBusy } from './accountsModel';

/** Server rule: a trimmed name of 1–64 characters, unique within the connector. */
export const MAX_ACCOUNT_NAME_LENGTH = 64;

/**
 * Connect, re-authorize, rename and remove the OAuth accounts of one
 * connector, with the feedback each outcome needs. Use it from a component
 * keyed by connector id, so a running flow's state never shows on another one.
 */
export const useConnectorAccountFlows = (connector: ConnectorWithTools) => {
  const { t } = useTranslation('tool');

  const connectConnectorAccount = useToolStore((s) => s.connectConnectorAccount);
  const reauthorizeConnectorAccount = useToolStore((s) => s.reauthorizeConnectorAccount);
  const renameConnectorAccount = useToolStore((s) => s.renameConnectorAccount);
  const removeConnectorAccount = useToolStore((s) => s.removeConnectorAccount);

  const [busy, setBusy] = useState<AccountBusy>();
  // A failed authorization stays in place: the toast is usually gone by the
  // time the user is back from the provider's window.
  const [failure, setFailure] = useState<string>();

  const nameOf = (linkId?: string) =>
    linkId ? connectorSelectors.connectorLinkNameById(linkId)(useToolStore.getState()) : undefined;

  const reportFailure = (error: unknown, lead: (reason: string) => string) => {
    if (isDismissedAuthorization(error)) return;
    // A stale manage policy: refetch it so the controls turn disabled with
    // their reason, as the rest of the connector page does.
    if (isPermissionRejection(error)) {
      void refreshConnectorManagePolicy();
      return;
    }
    const message = lead(formatAccountErrorReason(t, error));
    toast.error(message);
    setFailure(message);
  };

  const announceConnect = (result: ConnectorAccountFlowResult) => {
    const name = nameOf(result.linkId);
    if (result.outcome === 'matchedExisting') {
      // Nothing new shows up in the list, so this is the only sign of what happened.
      toast.info({
        description: t('connector.account.alreadyConnectedDesc'),
        title: name
          ? t('connector.account.alreadyConnected', { name })
          : t('connector.account.alreadyConnectedUnnamed'),
      });
      return;
    }
    // The new row is the result; the toast only acknowledges it.
    if (name) toast.success(t('connector.account.connected', { name }));
  };

  const announceReauthorize = (
    result: ConnectorAccountFlowResult,
    target: ConnectorLinkSummary,
  ) => {
    if (result.outcome === 'matchedExisting') {
      // The provider signed in as another connected account; that one was
      // refreshed, the account the user picked was not.
      toast.warning({
        description: t('connector.account.reauthorizeMismatchDesc', {
          // The store is refetched before the action resolves, so the matched
          // account is listed; its raw id is the last resort.
          matched: nameOf(result.linkId) ?? result.linkId ?? '',
          name: target.name,
        }),
        title: t('connector.account.reauthorizeMismatch', { name: target.name }),
      });
      return;
    }
    toast.success(
      t('connector.account.reauthorized', { name: nameOf(result.linkId) ?? target.name }),
    );
  };

  /** Call from the click itself: the web popup must open before any await. */
  const connect = async () => {
    const popup = openConnectorOAuthPopup();
    const lead = (reason: string) => t('connector.account.connectFailed', { reason });
    setFailure(undefined);
    if (popup === null) {
      reportFailure(new ConnectorOAuthError('blocked'), lead);
      return;
    }
    setBusy({ kind: 'connect' });
    try {
      announceConnect(await connectConnectorAccount(connector.id, { popup }));
    } catch (error) {
      reportFailure(error, lead);
    } finally {
      setBusy(undefined);
    }
  };

  /** Call from the click itself, like {@link connect}. */
  const reauthorize = async (link: ConnectorLinkSummary) => {
    const popup = openConnectorOAuthPopup();
    const lead = (reason: string) =>
      t('connector.account.reauthorizeFailed', { name: link.name, reason });
    setFailure(undefined);
    if (popup === null) {
      reportFailure(new ConnectorOAuthError('blocked'), lead);
      return;
    }
    setBusy({ kind: 'reauthorize', linkId: link.id });
    try {
      announceReauthorize(
        await reauthorizeConnectorAccount(connector.id, link.id, { popup }),
        link,
      );
    } catch (error) {
      reportFailure(error, lead);
    } finally {
      setBusy(undefined);
    }
  };

  const rename = (link: ConnectorLinkSummary) => {
    openRenameModal({
      defaultValue: link.name,
      description: t('connector.account.renameDesc'),
      maxLength: MAX_ACCOUNT_NAME_LENGTH,
      title: t('connector.account.renameTitle'),
      onSave: async (name) => {
        try {
          await renameConnectorAccount(connector.id, link.id, name);
        } catch (error) {
          // Same as the other writes: refetch the stale gate and let the
          // controls turn disabled; the dialog closes on its own.
          if (isPermissionRejection(error)) {
            void refreshConnectorManagePolicy();
            return;
          }
          toast.error(
            isConnectorLinkNameConflict(error)
              ? t('connector.account.renameConflict', { name })
              : t('connector.account.renameFailed', {
                  reason: formatAccountErrorReason(t, error),
                }),
          );
          // Rejecting keeps the dialog open with the typed name to fix.
          throw error;
        }
      },
    });
  };

  const remove = (link: ConnectorLinkSummary) => {
    confirmModal({
      // The modal's built-in label is not localized.
      cancelText: t('cancel', { ns: 'common' }),
      content:
        (connector.links?.length ?? 0) <= 1
          ? t('connector.account.removeLastConfirmContent')
          : t('connector.account.removeConfirmContent'),
      okButtonProps: { danger: true },
      okText: t('connector.account.removeConfirmOk'),
      onOk: async () => {
        setFailure(undefined);
        setBusy({ kind: 'remove', linkId: link.id });
        try {
          await removeConnectorAccount(connector.id, link.id);
        } catch (error) {
          reportFailure(error, (reason) =>
            t('connector.account.removeFailed', { name: link.name, reason }),
          );
        } finally {
          setBusy(undefined);
        }
      },
      title: t('connector.account.removeConfirmTitle', { name: link.name }),
    });
  };

  return { busy, connect, failure, reauthorize, remove, rename };
};
