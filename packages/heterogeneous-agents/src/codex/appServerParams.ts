import path from 'node:path';

import type { AgentInputPlan } from '../spawn/input';
import {
  CODEX_APPROVAL_FLAGS,
  CODEX_CONFIG_FLAGS,
  CODEX_CWD_FLAGS,
  CODEX_DANGEROUS_BYPASS_FLAG,
  CODEX_EPHEMERAL_FLAG,
  CODEX_FULL_AUTO_FLAG,
  CODEX_MODEL_FLAGS,
  CODEX_SANDBOX_FLAGS,
  getFlagValue,
  isSandboxMode,
  parseConfigOverride,
} from './appServerArgs';
import type { JsonValue, SandboxMode, ThreadStartParams, UserInput } from './protocol';

export { buildCodexAppServerArgs, getCodexAppServerUnsupportedArgs } from './appServerArgs';

export const buildCodexAppServerThreadParams = (
  args: string[],
  cwd: string,
  initialModel?: string,
): ThreadStartParams => {
  const config: Record<string, JsonValue> = {
    'features.default_mode_request_user_input': true,
  };
  let effectiveCwd = cwd;
  let ephemeral = false;
  let model = initialModel;
  let modelProvider: string | undefined;
  let sandbox: SandboxMode = 'danger-full-access';
  let serviceTier: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === CODEX_DANGEROUS_BYPASS_FLAG) {
      sandbox = 'danger-full-access';
      continue;
    }
    if (arg === CODEX_FULL_AUTO_FLAG) {
      sandbox = 'workspace-write';
      continue;
    }
    if (arg === CODEX_EPHEMERAL_FLAG) {
      ephemeral = true;
      continue;
    }

    const next = args[index + 1];
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
    if (approvalValue !== undefined) continue;
    if (CODEX_APPROVAL_FLAGS.includes(arg as (typeof CODEX_APPROVAL_FLAGS)[number]) && next) {
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

  return {
    approvalPolicy: 'never',
    ...(Object.keys(config).length > 0 ? { config } : {}),
    cwd: effectiveCwd,
    ...(ephemeral ? { ephemeral } : {}),
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    sandbox,
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
