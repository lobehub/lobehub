import type { InjectCredsResponse } from '@lobehub/market-sdk';
import debug from 'debug';

import type { MarketService } from '@/server/services/market';

import { getSandboxProviderKind } from './factory';
import { OnlyboxesSandboxProvider } from './providers/onlyboxes';

const log = debug('lobe-server:sandbox:credentials');

const ENV_NAME_PATTERN = /^[_a-z]\w*$/i;

/** The part of Market's personal or organization creds API the injection reads. */
interface CredsAccessor {
  get: (
    id: number,
    options?: { decrypt?: boolean },
  ) => Promise<{ plaintext?: Record<string, string> }>;
  list: () => Promise<{ data?: Array<{ id: number; key: string; type: string }> }>;
}

export interface InjectSandboxCredsParams {
  /** Personal `market.creds`, or the workspace's organization creds. Read only on Onlyboxes. */
  getCredsAccessor: () => CredsAccessor;
  keys: string[];
  marketService: MarketService;
  sandbox?: boolean;
  topicId: string;
  userId: string;
}

/** Same shape as Market's masked display values, e.g. `gh******Gm`. */
const maskValue = (value: string) =>
  value.length >= 8 ? `${value.slice(0, 2)}******${value.slice(-2)}` : '******';

/**
 * Inject saved credentials into the topic's cloud sandbox.
 *
 * Market's inject endpoint writes the real values into Market's own sandbox
 * session and answers with masked ones. With `SANDBOX_PROVIDER=onlyboxes`
 * nothing runs in that session, so the values are decrypted here and written
 * into the Onlyboxes session instead, where every later command gets them as
 * environment variables. Only `kv-env` credentials can take that route: an
 * OAuth token never leaves Market, Market itself skips `kv-header` credentials
 * in a sandbox, and `file` credentials are not supported there yet. Those come
 * back in `unsupportedInSandbox` rather than being reported as injected.
 */
export const injectSandboxCreds = async ({
  getCredsAccessor,
  keys,
  marketService,
  sandbox,
  topicId,
  userId,
}: InjectSandboxCredsParams): Promise<InjectCredsResponse> => {
  if (sandbox === false || getSandboxProviderKind() !== 'onlyboxes') {
    return marketService.market.creds.inject({ keys, sandbox, topicId, userId });
  }

  const credsAccessor = getCredsAccessor();
  const { data = [] } = await credsAccessor.list();
  const env: Record<string, string> = {};
  const notFound: string[] = [];
  const unsupportedInSandbox: string[] = [];

  for (const key of keys) {
    const cred = data.find((item) => item.key === key);

    if (!cred) {
      notFound.push(key);
      continue;
    }

    if (cred.type !== 'kv-env') {
      unsupportedInSandbox.push(key);
      continue;
    }

    const { plaintext = {} } = await credsAccessor.get(cred.id, { decrypt: true });
    const entries = Object.entries(plaintext).filter(
      ([name, value]) => ENV_NAME_PATTERN.test(name) && typeof value === 'string' && value,
    );

    if (entries.length === 0) {
      unsupportedInSandbox.push(key);
      continue;
    }

    Object.assign(env, Object.fromEntries(entries));
  }

  if (Object.keys(env).length > 0) {
    await new OnlyboxesSandboxProvider({ marketService, topicId, userId }).writeCommandEnv(env);
  }

  log(
    'Injected %d variables into Onlyboxes session for topic %s (notFound=%O, unsupported=%O)',
    Object.keys(env).length,
    topicId,
    notFound,
    unsupportedInSandbox,
  );

  return {
    credentials: {
      env: Object.fromEntries(Object.entries(env).map(([name, value]) => [name, maskValue(value)])),
      files: [],
      headers: {},
    },
    notFound,
    success: notFound.length === 0 && unsupportedInSandbox.length === 0,
    unsupportedInSandbox,
  };
};
