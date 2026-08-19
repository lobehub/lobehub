import type { DeviceExecutionTarget, HeterogeneousApiConfig } from '@lobechat/types';

export type ClaudeCodeCredentialMode = 'direct' | 'gateway';

export interface ClaudeCodeModelRoles {
  background: string;
  primary: string;
  smallFast: string;
  subagent: string;
}

export interface ClaudeCodeLaunchPlan {
  args: string[];
  credentialMode: ClaudeCodeCredentialMode;
  env: Record<string, string>;
  modelRoles: ClaudeCodeModelRoles;
  requiredCapability: 'direct' | 'gateway';
  scrubEnv: string[];
  target: DeviceExecutionTarget;
}

export interface ResolveClaudeCodeLaunchPlanInput {
  apiConfig: HeterogeneousApiConfig;
  args?: string[];
  capability?: {
    direct?: boolean;
    gateway?: 'anthropic-messages';
  };
  providerEnabled: boolean;
  providerHasApiKey: boolean;
  providerReachableFromGateway?: boolean;
  target: DeviceExecutionTarget;
}

export interface ResolveClaudeCodeLaunchPlanResult {
  error?: string;
  plan?: ClaudeCodeLaunchPlan;
}

export const CLAUDE_CODE_MANAGED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

const sanitizeArgs = (source: string[] | undefined): string[] => {
  const args: string[] = [];
  for (let index = 0; index < (source?.length ?? 0); index += 1) {
    const arg = source![index];
    if (arg === '--model') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--model=')) continue;
    args.push(arg);
  }
  return args;
};

/** Resolve a serializable, secret-free Claude Code launch contract. */
export const resolveClaudeCodeLaunchPlan = (
  input: ResolveClaudeCodeLaunchPlanInput,
): ResolveClaudeCodeLaunchPlanResult => {
  const providerId = input.apiConfig.providerId.trim();
  const model = input.apiConfig.model.trim();
  const smallFastModel = input.apiConfig.smallFastModel?.trim() || model;

  if (!providerId) return { error: 'Claude Code API provider is required.' };
  if (!model) return { error: 'Claude Code API model is required.' };
  if (!input.providerEnabled) return { error: `Provider "${providerId}" is disabled or missing.` };
  if (!input.providerHasApiKey) return { error: `Provider "${providerId}" has no BYOK API key.` };

  const isDirect = input.target === 'local';
  const requiredCapability = isDirect ? 'direct' : 'gateway';
  if (requiredCapability === 'direct' && input.capability?.direct !== true) {
    return { error: `Provider "${providerId}" has not enabled Claude Code direct mode.` };
  }
  if (requiredCapability === 'gateway' && input.capability?.gateway !== 'anthropic-messages') {
    return { error: `Provider "${providerId}" has not enabled the Claude Code Gateway.` };
  }
  if (!isDirect && input.providerReachableFromGateway === false) {
    return { error: `Provider "${providerId}" is not reachable from the server gateway.` };
  }

  const modelRoles = {
    background: smallFastModel,
    primary: model,
    smallFast: smallFastModel,
    subagent: model,
  } satisfies ClaudeCodeModelRoles;

  return {
    plan: {
      args: sanitizeArgs(input.args),
      credentialMode: isDirect ? 'direct' : 'gateway',
      env: {
        ANTHROPIC_MODEL: model,
        ANTHROPIC_SMALL_FAST_MODEL: smallFastModel,
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
        CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
        CLAUDE_CODE_USE_BEDROCK: '0',
        CLAUDE_CODE_USE_MANTLE: '0',
        CLAUDE_CODE_USE_VERTEX: '0',
      },
      modelRoles,
      requiredCapability,
      scrubEnv: [...CLAUDE_CODE_MANAGED_ENV_KEYS],
      target: input.target,
    },
  };
};
