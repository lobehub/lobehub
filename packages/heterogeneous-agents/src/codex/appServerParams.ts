import path from 'node:path';

import type { CodexPermissionMode, CodexPermissionProfile } from '@lobechat/types';
import { getCodexPermissionProfile, stripCodexPermissionArgs } from '@lobechat/types';

import type { AgentInputPlan } from '../spawn/input';
import type {
  ApprovalsReviewer,
  AskForApproval,
  JsonValue,
  SandboxMode,
  ThreadStartParams,
  UserInput,
} from './protocol';

export type { CodexPermissionProfile };
export { getCodexPermissionProfile };

const CODEX_DANGEROUS_BYPASS_FLAG = '--dangerously-bypass-approvals-and-sandbox';
const CODEX_FULL_AUTO_FLAG = '--full-auto';
const CODEX_APPROVAL_FLAGS = ['-a', '--ask-for-approval'] as const;
const CODEX_CONFIG_FLAGS = ['-c', '--config'] as const;
const CODEX_CWD_FLAGS = ['-C', '--cd'] as const;
const CODEX_EPHEMERAL_FLAG = '--ephemeral';
const CODEX_IGNORE_USER_CONFIG_FLAG = '--ignore-user-config';
const CODEX_MODEL_FLAGS = ['-m', '--model'] as const;
const CODEX_PROFILE_FLAGS = ['-p', '--profile'] as const;
const CODEX_SANDBOX_FLAGS = ['-s', '--sandbox'] as const;

const getFlagValue = (arg: string, flags: readonly string[]) => {
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

const parseConfigOverride = (raw: string) => {
  const separator = raw.indexOf('=');
  if (separator <= 0) return;
  const key = raw.slice(0, separator).trim();
  if (!key) return;
  return { key, value: parseConfigValue(raw.slice(separator + 1)) };
};

/** Recognizes only named approval policies supported by the app-server RPC contract. */
const isAppServerApprovalPolicy = (value: unknown): value is Extract<AskForApproval, string> =>
  value === 'never' || value === 'on-request' || value === 'untrusted';

/** Validates the reviewer without changing which native agent receives approval requests. */
const isApprovalsReviewer = (value: unknown): value is ApprovalsReviewer =>
  value === 'user' || value === 'auto_review' || value === 'guardian_subagent';

const isSandboxMode = (value: string): value is SandboxMode =>
  value === 'danger-full-access' || value === 'read-only' || value === 'workspace-write';

/** Thread-scoped configuration is sent over RPC; the shared process needs only its subcommand. */
export const buildCodexAppServerArgs = (_args: string[] = []): string[] => ['app-server'];

/** Keep CLI semantics on exec when they cannot be represented by the app-server thread contract. */
export const getCodexAppServerUnsupportedArgs = (
  args: string[],
  options: { permissionMode?: CodexPermissionMode; resume?: boolean } = {},
): string[] => {
  const effectiveArgs = options.permissionMode ? (stripCodexPermissionArgs(args) ?? []) : args;
  const unsupported: string[] = [];
  const hasSandboxFlag = effectiveArgs.some(
    (arg) =>
      CODEX_SANDBOX_FLAGS.includes(arg as (typeof CODEX_SANDBOX_FLAGS)[number]) ||
      getFlagValue(arg, CODEX_SANDBOX_FLAGS) !== undefined,
  );

  for (let index = 0; index < effectiveArgs.length; index += 1) {
    const arg = effectiveArgs[index];
    if (arg === CODEX_DANGEROUS_BYPASS_FLAG) {
      if (hasSandboxFlag) unsupported.push(arg);
      continue;
    }
    if (arg === CODEX_EPHEMERAL_FLAG) {
      if (options.resume) unsupported.push(arg);
      continue;
    }
    if (arg === CODEX_FULL_AUTO_FLAG) continue;
    if (arg === CODEX_IGNORE_USER_CONFIG_FLAG) {
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
      const value = inlineFlag ? arg.slice(inlineFlag.length + 1) : effectiveArgs[index + 1];
      if (!value || (!inlineFlag && value.startsWith('-'))) {
        unsupported.push(arg);
        continue;
      }
      if (!inlineFlag) index += 1;

      if (
        CODEX_APPROVAL_FLAGS.includes(
          (exactFlag ?? inlineFlag) as (typeof CODEX_APPROVAL_FLAGS)[number],
        ) &&
        !isAppServerApprovalPolicy(value)
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
        if (override?.key === 'approval_policy' && !isAppServerApprovalPolicy(override.value))
          unsupported.push(arg);
        if (
          override?.key === 'sandbox_mode' &&
          (typeof override.value !== 'string' || !isSandboxMode(override.value))
        )
          unsupported.push(arg);
        if (override?.key === 'approvals_reviewer' && !isApprovalsReviewer(override.value))
          unsupported.push(arg);
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

/**
 * Builds the native policy used for both new and resumed Codex threads.
 *
 * Use when:
 * - Starting or resuming an app-server session after unsupported-argument validation.
 *
 * Expects:
 * - Ordered CLI arguments and the selected working directory.
 * - An optional saved preset that owns the complete permission scope.
 *
 * Returns:
 * - Native thread parameters with matching approval, reviewer, and sandbox fields.
 */
export const buildCodexAppServerThreadParams = (
  args: string[],
  cwd: string,
  initialModel?: string,
  permissionMode?: CodexPermissionMode,
): ThreadStartParams => {
  const effectiveArgs = permissionMode ? (stripCodexPermissionArgs(args) ?? []) : args;
  const config: Record<string, JsonValue> = {};
  let effectiveCwd = cwd;
  let ephemeral = false;
  let model = initialModel;
  let modelProvider: string | undefined;
  let sandbox: SandboxMode = 'danger-full-access';
  let approvalPolicy: AskForApproval = 'never';
  let serviceTier: string | undefined;

  for (let index = 0; index < effectiveArgs.length; index += 1) {
    const arg = effectiveArgs[index];
    if (arg === CODEX_DANGEROUS_BYPASS_FLAG) {
      sandbox = 'danger-full-access';
      approvalPolicy = 'never';
      continue;
    }
    if (arg === CODEX_FULL_AUTO_FLAG) {
      sandbox = 'workspace-write';
      approvalPolicy = 'on-request';
      continue;
    }
    if (arg === CODEX_EPHEMERAL_FLAG) {
      ephemeral = true;
      continue;
    }

    const next = effectiveArgs[index + 1];
    const modelValue = getFlagValue(arg, CODEX_MODEL_FLAGS);
    if (modelValue !== undefined) {
      if (modelValue) model = modelValue;
      continue;
    }
    if (CODEX_MODEL_FLAGS.includes(arg as (typeof CODEX_MODEL_FLAGS)[number]) && next) {
      model = next;
      index += 1;
      continue;
    }

    const approvalValue = getFlagValue(arg, CODEX_APPROVAL_FLAGS);
    if (approvalValue !== undefined) {
      if (isAppServerApprovalPolicy(approvalValue)) approvalPolicy = approvalValue;
      continue;
    }
    if (CODEX_APPROVAL_FLAGS.includes(arg as (typeof CODEX_APPROVAL_FLAGS)[number]) && next) {
      if (isAppServerApprovalPolicy(next)) approvalPolicy = next;
      index += 1;
      continue;
    }

    const sandboxValue = getFlagValue(arg, CODEX_SANDBOX_FLAGS);
    if (sandboxValue !== undefined) {
      if (isSandboxMode(sandboxValue)) sandbox = sandboxValue;
      continue;
    }
    if (CODEX_SANDBOX_FLAGS.includes(arg as (typeof CODEX_SANDBOX_FLAGS)[number]) && next) {
      if (isSandboxMode(next)) sandbox = next;
      index += 1;
      continue;
    }

    const cwdValue = getFlagValue(arg, CODEX_CWD_FLAGS);
    if (cwdValue !== undefined) {
      if (cwdValue) effectiveCwd = path.resolve(cwd, cwdValue);
      continue;
    }
    if (CODEX_CWD_FLAGS.includes(arg as (typeof CODEX_CWD_FLAGS)[number]) && next) {
      effectiveCwd = path.resolve(cwd, next);
      index += 1;
      continue;
    }

    const configValue = getFlagValue(arg, CODEX_CONFIG_FLAGS);
    const isConfigFlag = CODEX_CONFIG_FLAGS.includes(arg as (typeof CODEX_CONFIG_FLAGS)[number]);
    if (configValue === undefined && !isConfigFlag) continue;
    if (configValue === undefined && next) index += 1;
    const configOverride = parseConfigOverride(configValue ?? next ?? '');
    if (!configOverride) continue;
    config[configOverride.key] = configOverride.value;
    if (
      configOverride.key === 'approval_policy' &&
      isAppServerApprovalPolicy(configOverride.value)
    ) {
      approvalPolicy = configOverride.value;
    }
    if (configOverride.key === 'model' && typeof configOverride.value === 'string') {
      model = configOverride.value;
    }
    if (configOverride.key === 'model_provider' && typeof configOverride.value === 'string') {
      modelProvider = configOverride.value;
    }
    if (
      configOverride.key === 'sandbox_mode' &&
      typeof configOverride.value === 'string' &&
      isSandboxMode(configOverride.value)
    ) {
      sandbox = configOverride.value;
    }
    if (configOverride.key === 'service_tier' && typeof configOverride.value === 'string') {
      serviceTier = configOverride.value;
    }
  }

  const permissionProfile = permissionMode ? getCodexPermissionProfile(permissionMode) : undefined;
  // Presets own their complete scope, including inherited user-config expansions.
  if (permissionProfile && permissionProfile.sandbox !== 'danger-full-access') {
    for (const key of Object.keys(config)) {
      if (key === 'sandbox_workspace_write' || key.startsWith('sandbox_workspace_write.'))
        delete config[key];
    }
    config['sandbox_workspace_write.network_access'] = false;
    config['sandbox_workspace_write.writable_roots'] = [];
    config['sandbox_workspace_write.exclude_tmpdir_env_var'] = true;
    config['sandbox_workspace_write.exclude_slash_tmp'] = true;
  }

  return {
    approvalPolicy: permissionProfile?.approvalPolicy ?? approvalPolicy,
    approvalsReviewer:
      permissionProfile?.approvalsReviewer ??
      (isApprovalsReviewer(config.approvals_reviewer) ? config.approvals_reviewer : 'user'),
    ...(Object.keys(config).length > 0 ? { config } : {}),
    cwd: effectiveCwd,
    ...(ephemeral ? { ephemeral } : {}),
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    sandbox: permissionProfile?.sandbox ?? sandbox,
    ...(serviceTier ? { serviceTier } : {}),
  };
};

export const buildCodexAppServerInput = (plan: AgentInputPlan): UserInput[] => {
  const input: UserInput[] = [];
  if (plan.stdin) input.push({ text: plan.stdin, text_elements: [], type: 'text' });

  for (let index = 0; index < plan.args.length; index += 1) {
    if (plan.args[index] !== '--image') continue;
    const imagePath = plan.args[index + 1];
    if (imagePath) input.push({ path: imagePath, type: 'localImage' });
    index += 1;
  }

  return input;
};
