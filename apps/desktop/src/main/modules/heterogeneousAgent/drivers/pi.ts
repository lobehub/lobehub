import path from 'node:path';

import type { HeterogeneousProviderBindingProtocol } from '@lobechat/heterogeneous-agents';
import { PI_BASE_ARGS } from '@lobechat/heterogeneous-agents/spawn';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const HOST_API_KEY_ENV = 'LOBEHUB_PI_API_KEY';
const MODELS_FILE = 'models.json';
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

const PI_API_BY_PROTOCOL = {
  'anthropic-messages': 'anthropic-messages',
  'google-generative-ai': 'google-generative-ai',
  'openai-chat-completions': 'openai-completions',
  'openai-responses': 'openai-responses',
} as const satisfies Record<HeterogeneousProviderBindingProtocol, string>;

const CONTROLLED_FLAGS = [
  '--api-key',
  '--fork',
  '--model',
  '--models',
  '--provider',
  '--session',
  '--session-dir',
  '--session-id',
] as const;

const CONTROLLED_BOOLEAN_FLAGS = ['--continue', '-c', '--no-session', '--resume', '-r'] as const;

export const sanitizePiProviderBindingArgs = (source: string[]): string[] => {
  const args: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const arg = source[index];
    const controlledFlag = CONTROLLED_FLAGS.find(
      (flag) => arg === flag || arg.startsWith(`${flag}=`),
    );
    if (controlledFlag) {
      if (arg === controlledFlag) index += 1;
      continue;
    }
    // Provider-bound sessions are selected exclusively by Desktop. Caller
    // config cannot continue, resume, fork, replace, or disable that session.
    if (CONTROLLED_BOOLEAN_FLAGS.includes(arg as (typeof CONTROLLED_BOOLEAN_FLAGS)[number]))
      continue;
    args.push(arg);
  }
  return args;
};

const sanitizePiProviderBindingEnv = (source: Record<string, string> | undefined) => {
  const env = { ...source };
  delete env[HOST_API_KEY_ENV];
  delete env.PI_CODING_AGENT_DIR;
  delete env.PI_CODING_AGENT_SESSION_DIR;
  return env;
};

export const piDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const inputPlan = await helpers.buildAgentInput('pi', promptInput);

    return {
      args: [
        ...PI_BASE_ARGS,
        ...(resumeSessionId ? ['--session-id', resumeSessionId] : []),
        ...args,
        ...inputPlan.args,
      ],
      stdinPayload: inputPlan.stdin,
    };
  },
  prepareProviderBinding({ args, env, profileDir, resolution }) {
    if (!resolution.endpoint) throw new Error('Pi provider binding requires an API endpoint.');

    const apiKey = resolution.runtimeConfig.keyVaults.apiKey?.trim();
    if (!apiKey) throw new Error('Pi provider binding requires an API key.');

    const model = resolution.apiConfig.model;
    const metadata = resolution.modelMetadata;
    const providerId = `lobehub-${path.basename(profileDir)}`;
    const contextWindow =
      metadata?.contextWindowTokens && metadata.contextWindowTokens > 0
        ? metadata.contextWindowTokens
        : DEFAULT_CONTEXT_WINDOW;
    const maxTokens =
      metadata?.maxOutput && metadata.maxOutput > 0 ? metadata.maxOutput : DEFAULT_MAX_TOKENS;
    const modelsConfig = {
      providers: {
        [providerId]: {
          api: PI_API_BY_PROTOCOL[resolution.protocol],
          apiKey: `$${HOST_API_KEY_ENV}`,
          baseUrl: resolution.endpoint,
          models: [
            {
              contextWindow,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: model,
              input: metadata?.abilities?.vision ? ['text', 'image'] : ['text'],
              maxTokens,
              name: metadata?.displayName?.trim() || model,
              reasoning: metadata?.abilities?.reasoning === true,
            },
          ],
          name: 'LobeHub Provider',
        },
      },
    };

    return {
      // Keep host-authoritative routing before caller args. In particular, a
      // caller-provided `--` ends Pi option parsing but cannot hide these flags.
      args: ['--provider', providerId, '--model', model, ...sanitizePiProviderBindingArgs(args)],
      env: {
        ...sanitizePiProviderBindingEnv(env),
        [HOST_API_KEY_ENV]: apiKey,
        PI_CODING_AGENT_DIR: profileDir,
      },
      profileFiles: [{ content: `${JSON.stringify(modelsConfig, null, 2)}\n`, path: MODELS_FILE }],
    };
  },
  prepareServerDefaultBinding({ args, endpoint, env, model, profileDir }) {
    const providerId = 'lobehub-server-default';
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    const modelsConfig = {
      providers: {
        [providerId]: {
          api: 'openai-responses',
          apiKey: `$${HOST_API_KEY_ENV}`,
          baseUrl: `${endpoint}/api/v1/openai/v1`,
          models: [
            {
              contextWindow: DEFAULT_CONTEXT_WINDOW,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: requestModel,
              input: ['text'],
              maxTokens: DEFAULT_MAX_TOKENS,
              name: model,
              reasoning: false,
            },
          ],
          name: 'LobeHub Server Default',
        },
      },
    };

    return {
      args: [
        '--provider',
        providerId,
        '--model',
        requestModel,
        ...sanitizePiProviderBindingArgs(args),
      ],
      env: {
        ...sanitizePiProviderBindingEnv(env),
        PI_CODING_AGENT_DIR: profileDir,
      },
      operationTokenEnvKey: HOST_API_KEY_ENV,
      profileFiles: [{ content: `${JSON.stringify(modelsConfig, null, 2)}\n`, path: MODELS_FILE }],
    };
  },
};
