import {
  type ConnectorLinkSummary,
  type ConnectorWithTools,
  supportsMultipleConnectorAccounts,
} from '@/store/tool/slices/connector/types';

/** The account flow running in the Accounts section, if any. Only one window at a time. */
export type AccountBusy =
  | { kind: 'connect' }
  | { kind: 'reauthorize'; linkId: string }
  | { kind: 'remove'; linkId: string };

export interface AccountsSectionModel {
  /** The section's add button, absent when this connector cannot take another account. */
  add?: { kind: 'connect' | 'connectAnother'; primary: boolean };
  empty: boolean;
  /** Every account control is off: the viewer cannot manage, or a flow is running. */
  locked: boolean;
  /** With two or more accounts the model picks one by name, so names must differ. */
  showNamingHint: boolean;
  /**
   * A browser reuses whoever is signed in to the provider; the desktop window
   * starts from a clean session for a new account, so it needs no hint.
   */
  showSwitchHint: boolean;
}

export const getAccountsSectionModel = ({
  busy,
  canManage,
  connector,
  isDesktop,
}: {
  busy?: AccountBusy;
  canManage: boolean;
  connector: ConnectorWithTools;
  isDesktop: boolean;
}): AccountsSectionModel => {
  const count = connector.links?.length ?? 0;
  const canAdd = supportsMultipleConnectorAccounts(connector);

  return {
    // The first account is the section's main task; later ones are optional.
    add: canAdd
      ? { kind: count > 0 ? 'connectAnother' : 'connect', primary: count === 0 }
      : undefined,
    empty: count === 0,
    locked: !canManage || !!busy,
    showNamingHint: count > 1,
    showSwitchHint: canAdd && !isDesktop && count > 0,
  };
};

/** The action running on one account row. */
export const getRowBusyAction = (
  busy: AccountBusy | undefined,
  linkId: string,
): 'reauthorize' | 'remove' | undefined =>
  busy && busy.kind !== 'connect' && busy.linkId === linkId ? busy.kind : undefined;

/**
 * Second line of an account row: the signed-in identity when the name does not
 * already say it (the default name is the email), then who authorized it when
 * `formatAuthorizer` is given (in a workspace; in a personal space it is always
 * the viewer). Empty when there is nothing to add.
 */
export const getAccountDetails = (
  link: ConnectorLinkSummary,
  formatAuthorizer?: (name: string) => string,
): string => {
  const identity = link.profile?.email || link.profile?.username;

  return [
    identity && identity.toLowerCase() !== link.name.toLowerCase() ? identity : undefined,
    formatAuthorizer && link.authorizedByName ? formatAuthorizer(link.authorizedByName) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
};
