import { buildCopilotAcpArgs } from '@lobechat/heterogeneous-agents/spawn';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

import type { HeterogeneousAgentDriver } from '../types';

/**
 * Variables that choose Copilot's model backend. Under a LobeHub binding only
 * the plan sets them: a user `COPILOT_PROVIDER_BEARER_TOKEN` or
 * `COPILOT_PROVIDER_API_KEY_COMMAND` outranks the operation token,
 * `COPILOT_PROVIDER_WIRE_MODEL` renames the request, and `COPILOT_HOME` holds a
 * persisted `model` / per-subagent models.
 */
const ownsCopilotBindingEnvKey = (key: string): boolean =>
  key.startsWith('COPILOT_PROVIDER_') ||
  key === 'COPILOT_HOME' ||
  key === 'COPILOT_MODEL' ||
  key === 'COPILOT_OFFLINE';

/** `--model` outranks `COPILOT_MODEL`, so a native selection would leave the relay. */
const stripCopilotModelArgs = (source: string[]): string[] => {
  const args: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '--model') {
      index += 1;
      continue;
    }
    if (!source[index].startsWith('--model=')) args.push(source[index]);
  }
  return args;
};

/** GitHub Copilot prompts run through its native bidirectional ACP session. */
export const copilotDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({ args }) {
    return { args: buildCopilotAcpArgs(args) };
  },
  /**
   * Copilot's BYOK provider in ACP mode (honored since 1.0.56, probed on
   * 1.0.105). The Anthropic type posts to `${BASE_URL}/v1/messages` with
   * `x-api-key`; LobeHub's OpenAI ingress only serves Responses, not the Chat
   * Completions Copilot sends by default. Offline mode skips GitHub auth and
   * routing, so a broken binding fails instead of reaching GitHub's models.
   */
  prepareServerDefaultBinding({ args, endpoint, env, model, modelDescriptor, profileDir }) {
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    const maxOutput = modelDescriptor?.maxOutput ?? 0;
    const userEnv = Object.entries(env ?? {}).filter(([key]) => !ownsCopilotBindingEnvKey(key));
    return {
      args: stripCopilotModelArgs(args),
      env: {
        ...Object.fromEntries(userEnv),
        COPILOT_HOME: profileDir,
        COPILOT_MODEL: requestModel,
        COPILOT_OFFLINE: 'true',
        COPILOT_PROVIDER_BASE_URL: `${endpoint}/api/v1/anthropic`,
        ...(maxOutput > 0 && { COPILOT_PROVIDER_MAX_OUTPUT_TOKENS: String(maxOutput) }),
        COPILOT_PROVIDER_TYPE: 'anthropic',
      },
      // `session/set_model` overrides COPILOT_MODEL, so select the same request model.
      model: requestModel,
      operationTokenEnvKey: 'COPILOT_PROVIDER_API_KEY',
      ownsEnvKey: ownsCopilotBindingEnvKey,
    };
  },
};
