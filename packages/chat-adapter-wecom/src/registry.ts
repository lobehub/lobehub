import type { WeComLongConnection } from './connection';

/**
 * Live WeCom connections held by this process, keyed by BotID.
 *
 * WeCom AI bots have no REST send API: a reply must go out on the socket that received the
 * message. The gateway client that opened the connection registers it here, and the adapter and
 * messenger find it when they answer. Kept on `globalThis` because the webhook route and the
 * gateway can load this module through different bundles of the same process.
 */
const REGISTRY_KEY = Symbol.for('lobehub.chat-adapter-wecom.connections');

const getStore = (): Map<string, WeComLongConnection> => {
  const holder = globalThis as unknown as Record<symbol, Map<string, WeComLongConnection>>;
  holder[REGISTRY_KEY] ??= new Map();
  return holder[REGISTRY_KEY];
};

export const registerWeComConnection = (connection: WeComLongConnection): void => {
  getStore().set(connection.botId, connection);
};

/** Remove `connection` — only if it is still the registered one, so a stale stop is harmless. */
export const unregisterWeComConnection = (connection: WeComLongConnection): void => {
  const store = getStore();
  if (store.get(connection.botId) === connection) store.delete(connection.botId);
};

export const getWeComConnection = (botId: string): WeComLongConnection | undefined =>
  getStore().get(botId);

export class WeComConnectionUnavailableError extends Error {
  constructor(botId: string) {
    super(
      `WeCom bot ${botId} has no live long connection in this process; replies can only be sent on the connection that holds the bot`,
    );
    this.name = 'WeComConnectionUnavailableError';
  }
}

/** The live connection for `botId`, or a descriptive error when this process does not hold it. */
export const requireWeComConnection = (botId: string): WeComLongConnection => {
  const connection = getWeComConnection(botId);
  if (!connection?.isConnected) throw new WeComConnectionUnavailableError(botId);
  return connection;
};
