import { ConnectorModel, type DecryptedConnector } from '../../models/connector';
import {
  type ConnectorLinkAuthorization,
  type ConnectorLinkAuthorizationResult,
  ConnectorLinkModel,
} from '../../models/connectorLink';
import { ConnectorStatus } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

/**
 * Account flows that change a connector together with its links. A connector
 * keeps either static credentials on its own row or OAuth accounts as links,
 * never both, so each flow locks the connector and writes both sides in one
 * transaction.
 */
export class ConnectorAccountRepo {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    private readonly gateKeeper?: GateKeeper,
  ) {}

  private models = (tx: Transaction) => ({
    connectors: new ConnectorModel(tx, this.userId, this.workspaceId, this.gateKeeper),
    links: new ConnectorLinkModel(tx, this.userId, this.workspaceId, this.gateKeeper),
  });

  /**
   * Move OAuth credentials still stored on the connector row onto a link.
   * Static credentials stay where they are. Safe to call on every read: a
   * connector without legacy OAuth credentials is left untouched.
   */
  adoptLegacyCredentials = async (
    connector: Pick<DecryptedConnector, 'credentials' | 'id'>,
  ): Promise<void> => {
    if (connector.credentials?.type !== 'oauth2') return;
    await this.db.transaction(async (tx) => {
      const { connectors, links } = this.models(tx);
      // Re-read under the lock: a concurrent adoption may have emptied the slot.
      const parent = await connectors.lockCredentialSlot(connector.id);
      if (parent?.credentials?.type !== 'oauth2') return;
      await links.adoptCredentials(parent.id, {
        authorizerId: parent.userId,
        credentials: parent.credentials,
        status: parent.status === ConnectorStatus.error ? 'error' : 'connected',
        tokenExpiresAt: parent.tokenExpiresAt,
      });
      await connectors.clearCredentialSlot(parent.id);
    });
  };

  /** Store a completed OAuth authorization as an account of the connector. */
  saveAuthorization = (
    connectorId: string,
    params: ConnectorLinkAuthorization,
  ): Promise<ConnectorLinkAuthorizationResult> =>
    this.db.transaction(async (tx) => {
      const { connectors, links } = this.models(tx);
      if (!(await connectors.lockCredentialSlot(connectorId)))
        throw new Error('Connector not found');
      const result = await links.applyAuthorization(connectorId, params);
      // OAuth replaces whatever static credential the row still carried.
      await connectors.clearCredentialSlot(connectorId);
      return result;
    });

  /** Remove one account; a connector left without any reads as disconnected. */
  removeLink = async (linkId: string): Promise<void> => {
    await this.db.transaction(async (tx) => {
      const { connectors, links } = this.models(tx);
      const link = await links.findById(linkId);
      if (!link) return;
      // Serialize with authorizations of the same connector before counting.
      if (!(await connectors.lockCredentialSlot(link.userConnectorId))) return;
      const removed = await links.remove(linkId);
      if (removed?.remaining === 0)
        await connectors.updateStatus(removed.connectorId, ConnectorStatus.disconnected);
    });
  };
}
