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
  /** Environment variable names per injected key (names only, never values). */
  envVarsByKey: Record<string, string[]>;
  injected: string[];
  notFound: string[];
  /** Variable names that could not be attributed to a single key. */
  unattributedEnvVars: string[];
  unsupportedInSandbox: string[];
}

const unique = (names: string[]) => [...new Set(names)];

export const resolveEnvVarsByKey = (
  injected: string[],
  input: Pick<InjectCredsResultInput, 'credentials' | 'envVarsByKey'>,
): { envVarsByKey: Record<string, string[]>; unattributedEnvVars: string[] } => {
  const envNames = Object.keys(input.credentials?.env ?? {});
  const envVarsByKey: Record<string, string[]> = {};

  if (input.envVarsByKey) {
    for (const key of injected) {
      const names = input.envVarsByKey[key];
      if (names?.length) envVarsByKey[key] = unique(names);
    }
  } else if (injected.length === 1 && envNames.length > 0) {
    envVarsByKey[injected[0]] = envNames;
  }

  const attributed = new Set(Object.values(envVarsByKey).flat());
  return {
    envVarsByKey,
    unattributedEnvVars: envNames.filter((name) => !attributed.has(name)),
  };
};

export const buildInjectCredsResult = (
  keys: string[],
  input: InjectCredsResultInput,
): InjectCredsResultSummary => {
  const notFound = input.notFound ?? [];
  const unsupportedInSandbox = input.unsupportedInSandbox ?? [];
  const injected = keys.filter((k) => !notFound.includes(k));
  const { envVarsByKey, unattributedEnvVars } = resolveEnvVarsByKey(
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
    const names = envVarsByKey[key];
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
    envVarsByKey,
    injected,
    notFound,
    unattributedEnvVars,
    unsupportedInSandbox,
  };
};
