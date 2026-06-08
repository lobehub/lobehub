import { and, eq, inArray } from 'drizzle-orm';

import type {
  ConnectorCredentials,
  ConnectorStatus,
  NewUserConnector,
  UserConnectorItem,
} from '../schemas';
import { userConnectors } from '../schemas';
import type { LobeChatDatabase } from '../type';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export interface DecryptedConnector extends Omit<UserConnectorItem, 'credentials'> {
  credentials: ConnectorCredentials | null;
}

type CreateConnectorParams = Omit<NewUserConnector, 'userId' | 'id' | 'createdAt' | 'updatedAt'>;

type UpdateConnectorParams = Partial<
  Omit<NewUserConnector, 'userId' | 'id' | 'createdAt' | 'updatedAt'>
>;

export class ConnectorModel {
  private userId: string;
  private db: LobeChatDatabase;
  private gateKeeper?: GateKeeper;

  constructor(db: LobeChatDatabase, userId: string, gateKeeper?: GateKeeper) {
    this.db = db;
    this.userId = userId;
    this.gateKeeper = gateKeeper;
  }

  create = async (
    params: CreateConnectorParams,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<UserConnectorItem> => {
    const credentials = params.credentials
      ? await encryptCredentials(params.credentials, gateKeeper)
      : null;

    const [result] = await this.db
      .insert(userConnectors)
      .values({ ...params, credentials, userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string): Promise<void> => {
    await this.db
      .delete(userConnectors)
      .where(and(eq(userConnectors.id, id), eq(userConnectors.userId, this.userId)));
  };

  query = async (
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(eq(userConnectors.userId, this.userId));

    return Promise.all(rows.map((r) => decryptRow(r, gateKeeper)));
  };

  queryByIdentifiers = async (
    identifiers: string[],
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector[]> => {
    if (identifiers.length === 0) return [];

    const rows = await this.db
      .select()
      .from(userConnectors)
      .where(
        and(
          eq(userConnectors.userId, this.userId),
          inArray(userConnectors.identifier, identifiers),
        ),
      );

    return Promise.all(rows.map((r) => decryptRow(r, gateKeeper)));
  };

  findById = async (
    id: string,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<DecryptedConnector | null> => {
    const [row] = await this.db
      .select()
      .from(userConnectors)
      .where(and(eq(userConnectors.id, id), eq(userConnectors.userId, this.userId)))
      .limit(1);

    if (!row) return null;
    return decryptRow(row, gateKeeper);
  };

  update = async (
    id: string,
    patch: UpdateConnectorParams,
    gateKeeper: GateKeeper | undefined = this.gateKeeper,
  ): Promise<void> => {
    const credentials =
      patch.credentials !== undefined && patch.credentials !== null
        ? await encryptCredentials(patch.credentials, gateKeeper)
        : undefined;

    const set = {
      ...patch,
      ...(credentials !== undefined ? { credentials } : {}),
      updatedAt: new Date(),
    };

    await this.db
      .update(userConnectors)
      .set(set)
      .where(and(eq(userConnectors.id, id), eq(userConnectors.userId, this.userId)));
  };

  updateStatus = async (id: string, status: ConnectorStatus): Promise<void> => {
    await this.db
      .update(userConnectors)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(userConnectors.id, id), eq(userConnectors.userId, this.userId)));
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function encryptCredentials(credentials: string, gateKeeper?: GateKeeper): Promise<string> {
  if (!gateKeeper) return credentials;
  return gateKeeper.encrypt(credentials);
}

async function decryptRow(
  row: UserConnectorItem,
  gateKeeper?: GateKeeper,
): Promise<DecryptedConnector> {
  if (!row.credentials) return { ...row, credentials: null };

  try {
    const plain = gateKeeper
      ? (await gateKeeper.decrypt(row.credentials)).plaintext
      : row.credentials;
    return { ...row, credentials: JSON.parse(plain) as ConnectorCredentials };
  } catch {
    return { ...row, credentials: null };
  }
}
