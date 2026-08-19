/**
 * Redis-backed WeChat typing registry — the durable half of typing when the
 * resident poller host owns WeChat (the gateway's connection object is gone,
 * so nothing holds an in-memory typing state).
 *
 * Lifecycle mirrors the gateway's typing contract, message-level rather than
 * step-level: the inbound pipeline STARTS an entry when generation begins,
 * every step callback RENEWS it, and the completion callback CLEARS it. The
 * poller host's worker sweeps active entries every few seconds and sends the
 * platform typing pulse. The TTL is the crash backstop: a generation that
 * dies without its completion callback stops showing typing once the last
 * renewal expires.
 */

export interface WechatTypingEntry {
  applicationId: string;
  /** Present for messenger (system-bot) runs — resolves their credentials. */
  installationKey?: string;
  wechatUserId: string;
}

/** Minimal command surface — callers hold differently-typed redis clients. */
export interface WechatTypingRedis {
  del: (...keys: string[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  pexpire: (key: string, ms: number) => Promise<unknown>;
  scan: (
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ) => Promise<[string, string[]]>;
  set: (key: string, value: string, pxToken: 'PX', ms: number) => Promise<unknown>;
}

const KEY_PREFIX = 'wechat:typing:';

/**
 * Sized above real step durations (tool-heavy steps run past 90s) so typing
 * survives the gap between renewals; a run that crashes without completing
 * leaks a visible indicator for at most this long.
 */
export const WECHAT_TYPING_TTL_MS = 180_000;

/** Matches the gateway DO's pulse cadence (iLink typing display is short-lived). */
export const WECHAT_TYPING_PULSE_INTERVAL_MS = 4000;

// applicationId in the key keeps two bots talking to the same user from
// overwriting each other's slot; the userId may itself contain colons, so it
// goes last and is never parsed back out of the key.
const typingKey = (applicationId: string, wechatUserId: string): string =>
  `${KEY_PREFIX}${applicationId}:${wechatUserId}`;

export const requestWechatTyping = async (
  redis: WechatTypingRedis,
  entry: WechatTypingEntry,
): Promise<void> => {
  await redis.set(
    typingKey(entry.applicationId, entry.wechatUserId),
    JSON.stringify(entry),
    'PX',
    WECHAT_TYPING_TTL_MS,
  );
};

/** Reset the TTL of an existing entry; a missing (expired/cleared) one stays gone. */
export const renewWechatTyping = async (
  redis: WechatTypingRedis,
  applicationId: string,
  wechatUserId: string,
): Promise<void> => {
  await redis.pexpire(typingKey(applicationId, wechatUserId), WECHAT_TYPING_TTL_MS);
};

export const clearWechatTyping = async (
  redis: WechatTypingRedis,
  applicationId: string,
  wechatUserId: string,
): Promise<void> => {
  await redis.del(typingKey(applicationId, wechatUserId));
};

export const listActiveWechatTyping = async (
  redis: WechatTypingRedis,
): Promise<WechatTypingEntry[]> => {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');

  const entries: WechatTypingEntry[] = [];
  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue; // expired between scan and read
    try {
      entries.push(JSON.parse(raw) as WechatTypingEntry);
    } catch {
      await redis.del(key).catch(() => {});
    }
  }
  return entries;
};
