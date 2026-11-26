import type { JsonValue, SandboxMode } from './protocol';

/*
 * Browser-safe: which Codex CLI arguments the native app-server thread can
 * honor. Shared by the device dispatch (server), the desktop transport and the
 * composer's Plan switch, which grays out where a run would fall back to exec.
 */

export const CODEX_DANGEROUS_BYPASS_FLAG = '--dangerously-bypass-approvals-and-sandbox';
export const CODEX_FULL_AUTO_FLAG = '--full-auto';
export const CODEX_APPROVAL_FLAGS = ['-a', '--ask-for-approval'] as const;
export const CODEX_CONFIG_FLAGS = ['-c', '--config'] as const;
export const CODEX_CWD_FLAGS = ['-C', '--cd'] as const;
export const CODEX_EPHEMERAL_FLAG = '--ephemeral';
export const CODEX_IGNORE_USER_CONFIG_FLAG = '--ignore-user-config';
export const CODEX_MODEL_FLAGS = ['-m', '--model'] as const;
export const CODEX_PROFILE_FLAGS = ['-p', '--profile'] as const;
export const CODEX_SANDBOX_FLAGS = ['-s', '--sandbox'] as const;

export const getFlagValue = (arg: string, flags: readonly string[]) => {
  const flag = flags.find((candidate) => arg.startsWith(`${candidate}=`));
  return flag ? arg.slice(flag.length + 1) : undefined;
};

const parseConfigValue = (raw: string): JsonValue => {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  const number = Number(value);
  if (value && Number.isFinite(number)) return number;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('[') && value.endsWith(']')) ||
    (value.startsWith('{') && value.endsWith('}'))
  ) {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      // Keep non-JSON TOML values as strings; app-server validates the config.
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
};

export const parseConfigOverride = (raw: string) => {
  const separator = raw.indexOf('=');
  if (separator <= 0) return;
  const key = raw.slice(0, separator).trim();
  if (!key) return;
  return { key, value: parseConfigValue(raw.slice(separator + 1)) };
};

export const isSandboxMode = (value: string): value is SandboxMode =>
  value === 'danger-full-access' || value === 'read-only' || value === 'workspace-write';

/** Thread-scoped configuration is sent over RPC; the shared process needs only its subcommand. */
export const buildCodexAppServerArgs = (_args: string[] = []): string[] => ['app-server'];

/** Keep CLI semantics on exec when they cannot be represented by the app-server thread contract. */
export const getCodexAppServerUnsupportedArgs = (
  args: string[],
  options: { resume?: boolean } = {},
): string[] => {
  const unsupported: string[] = [];
  const hasSandboxFlag = args.some(
    (arg) =>
      CODEX_SANDBOX_FLAGS.includes(arg as (typeof CODEX_SANDBOX_FLAGS)[number]) ||
      getFlagValue(arg, CODEX_SANDBOX_FLAGS) !== undefined,
  );

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === CODEX_DANGEROUS_BYPASS_FLAG) {
      if (hasSandboxFlag) unsupported.push(arg);
      continue;
    }
    if (arg === CODEX_EPHEMERAL_FLAG) {
      if (options.resume) unsupported.push(arg);
      continue;
    }
    if (arg === CODEX_FULL_AUTO_FLAG || arg === CODEX_IGNORE_USER_CONFIG_FLAG) {
      unsupported.push(arg);
      continue;
    }

    const valueFlags = [
      ...CODEX_MODEL_FLAGS,
      ...CODEX_CONFIG_FLAGS,
      ...CODEX_CWD_FLAGS,
      ...CODEX_APPROVAL_FLAGS,
      ...CODEX_SANDBOX_FLAGS,
    ];
    const exactFlag = valueFlags.find((flag) => arg === flag);
    const inlineFlag = valueFlags.find((flag) => arg.startsWith(`${flag}=`));
    if (exactFlag || inlineFlag) {
      const value = inlineFlag ? arg.slice(inlineFlag.length + 1) : args[index + 1];
      if (!value || (!inlineFlag && value.startsWith('-'))) {
        unsupported.push(arg);
        continue;
      }
      if (!inlineFlag) index += 1;

      if (
        CODEX_APPROVAL_FLAGS.includes(
          (exactFlag ?? inlineFlag) as (typeof CODEX_APPROVAL_FLAGS)[number],
        ) &&
        value !== 'never'
      ) {
        unsupported.push(arg);
      }
      if (
        CODEX_SANDBOX_FLAGS.includes(
          (exactFlag ?? inlineFlag) as (typeof CODEX_SANDBOX_FLAGS)[number],
        ) &&
        !isSandboxMode(value)
      ) {
        unsupported.push(arg);
      }
      if (
        CODEX_CONFIG_FLAGS.includes(
          (exactFlag ?? inlineFlag) as (typeof CODEX_CONFIG_FLAGS)[number],
        )
      ) {
        const override = parseConfigOverride(value);
        if (override?.key === 'approval_policy' && override.value !== 'never') {
          unsupported.push(arg);
        }
      }
      continue;
    }

    if (
      CODEX_PROFILE_FLAGS.includes(arg as (typeof CODEX_PROFILE_FLAGS)[number]) ||
      getFlagValue(arg, CODEX_PROFILE_FLAGS) !== undefined
    ) {
      unsupported.push(arg);
      if (CODEX_PROFILE_FLAGS.includes(arg as (typeof CODEX_PROFILE_FLAGS)[number])) index += 1;
      continue;
    }

    unsupported.push(arg);
  }

  return unsupported;
};
