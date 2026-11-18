/**
 * Shapes the `injectCredsToSandbox` result shared by the server runtime and
 * the client executor.
 *
 * The result names every environment variable each credential key put into
 * the sandbox, so the agent can tell which variable a key maps to without
 * searching its env for it. Only the variable names are given. Values never
 * appear in the content: Market masks the `credentials.env` values, and even
 * masked fragments do not belong in the model's context.
 */

export interface InjectCredsResultInput {
  credentials?: {
    env?: Record<string, string>;
    files?: Array<{ filename: string; key: string; path: string }>;
  };
  /**
   * Environment variable names per credential key, resolved by the server
   * when one call injected several keys. Without it, only a single-key
   * injection can be attributed (every variable came from that key).
   */
  envVarsByKey?: Record<string, string[]>;
  notFound?: string[];
  unsupportedInSandbox?: string[];
}

export interface InjectCredsResultSummary {
  content: string;
  /**
   * `credentials` with every env value replaced by `******`. Market's masked
   * values keep the first and last two characters, which are still part of
   * the value, so they are not passed on in the tool state either.
   */
  credentials: NonNullable<InjectCredsResultInput['credentials']>;
  /** Environment variable names per injected key (names only, never values). */
  envVarsByKey: Record<string, string[]>;
  injected: string[];
  notFound: string[];
  /** Variable names that could not be attributed to a single key. */
  unattributedEnvVars: string[];
  unsupportedInSandbox: string[];
}

const unique = (names: string[]) => [...new Set(names)];

export const REDACTED_VALUE = '******';

const redactCredentials = (
  credentials: InjectCredsResultInput['credentials'] = {},
): NonNullable<InjectCredsResultInput['credentials']> => ({
  ...credentials,
  ...(credentials.env && {
    env: Object.fromEntries(Object.keys(credentials.env).map((name) => [name, REDACTED_VALUE])),
  }),
});

/**
 * Credential keys are user-chosen strings, so a key such as `constructor` or
 * `__proto__` must never resolve to an `Object.prototype` member. Keys are
 * held in a `Map` and the server mapping is read by own property only.
 */
const resolveEnvNamesByKey = (
  injected: string[],
  input: Pick<InjectCredsResultInput, 'credentials' | 'envVarsByKey'>,
): { byKey: Map<string, string[]>; unattributedEnvVars: string[] } => {
  const envNames = Object.keys(input.credentials?.env ?? {});
  const byKey = new Map<string, string[]>();
  const resolved = input.envVarsByKey;

  if (resolved) {
    for (const key of injected) {
      const names = Object.hasOwn(resolved, key) ? resolved[key] : undefined;
      if (Array.isArray(names) && names.length > 0) byKey.set(key, unique(names));
    }
  } else if (injected.length === 1 && envNames.length > 0) {
    byKey.set(injected[0], envNames);
  }

  const attributed = new Set([...byKey.values()].flat());
  return {
    byKey,
    unattributedEnvVars: envNames.filter((name) => !attributed.has(name)),
  };
};

export const resolveEnvVarsByKey = (
  injected: string[],
  input: Pick<InjectCredsResultInput, 'credentials' | 'envVarsByKey'>,
): { envVarsByKey: Record<string, string[]>; unattributedEnvVars: string[] } => {
  const { byKey, unattributedEnvVars } = resolveEnvNamesByKey(injected, input);
  // `Object.fromEntries` defines own properties, so even `__proto__` stays a key.
  return { envVarsByKey: Object.fromEntries(byKey), unattributedEnvVars };
};

export const buildInjectCredsResult = (
  keys: string[],
  input: InjectCredsResultInput,
): InjectCredsResultSummary => {
  const notFound = input.notFound ?? [];
  const unsupportedInSandbox = input.unsupportedInSandbox ?? [];
  const injected = keys.filter((k) => !notFound.includes(k));
  const { byKey, unattributedEnvVars } = resolveEnvNamesByKey(
    injected.filter((k) => !unsupportedInSandbox.includes(k)),
    input,
  );

  const lines: string[] = [];
  if (injected.length > 0) {
    lines.push(`Credentials injected successfully: ${injected.join(', ')}.`);
  }

  const filesByKey = new Map<string, string[]>();
  for (const file of input.credentials?.files ?? []) {
    filesByKey.set(file.key, [...(filesByKey.get(file.key) ?? []), file.path]);
  }

  const mappingLines: string[] = [];
  for (const key of injected) {
    const parts: string[] = [];
    const names = byKey.get(key);
    if (names?.length) parts.push(names.join(', '));
    const files = filesByKey.get(key);
    if (files?.length) parts.push(`file ${files.join(', ')}`);
    if (parts.length > 0) mappingLines.push(`- ${key} → ${parts.join('; ')}`);
  }
  if (unattributedEnvVars.length > 0) {
    mappingLines.push(`- (unattributed) → ${unattributedEnvVars.join(', ')}`);
  }
  if (mappingLines.length > 0) {
    lines.push('Injected per key (variable names only, values are never shown):', ...mappingLines);
  }

  let tail = '';
  if (notFound.length > 0) {
    tail += ` Not found: ${notFound.join(', ')}. Please configure them in Settings > Credentials.`;
  }
  if (unsupportedInSandbox.length > 0) {
    tail += ` Not supported in sandbox: ${unsupportedInSandbox.join(', ')}.`;
  }

  const content = [lines.join('\n'), tail.trim()].filter(Boolean).join('\n');

  return {
    content: content.trim(),
    credentials: redactCredentials(input.credentials),
    envVarsByKey: Object.fromEntries(byKey),
    injected,
    notFound,
    unattributedEnvVars,
    unsupportedInSandbox,
  };
};
