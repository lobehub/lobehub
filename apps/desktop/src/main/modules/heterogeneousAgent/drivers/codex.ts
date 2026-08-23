import path from 'node:path';

import {
  CODEX_DEFAULT_EXECUTION_ARGS,
  CODEX_EXECUTION_MODE_FLAGS,
  CODEX_REQUIRED_ARGS,
} from '@lobechat/heterogeneous-agents/spawn';
import type { CodexReasoningEffort, CodexServerDefaultModelMetadata } from '@lobechat/types';
import { formatServerDefaultHeterogeneousModel } from '@lobechat/types';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const hasAnyFlag = (args: string[], flags: readonly string[]) =>
  args.some((arg) => flags.includes(arg as (typeof flags)[number]));

const HOST_PROVIDER_ID = 'lobehub';
const HOST_API_KEY_ENV = 'LOBEHUB_CODEX_API_KEY';
const SERVER_TOKEN_ENV = 'LOBEHUB_HETERO_TOKEN';
const SERVER_DEFAULT_MODEL_CATALOG_FILE = 'models.json';
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

const CODEX_REASONING_LEVEL_DESCRIPTIONS = {
  high: 'Enhanced reasoning for complex tasks',
  low: 'Fast responses with lighter reasoning',
  max: 'Maximum reasoning depth for the hardest tasks',
} as const satisfies Partial<Record<CodexReasoningEffort, string>>;

const CODEX_SERVER_DEFAULT_BASE_INSTRUCTIONS =
  'You are Codex, a coding agent working with the user in a shared workspace. Follow the provided instructions, use tools when helpful, verify your changes, and report results clearly.';

const isConflictingConfigOverride = (value: string): boolean => {
  const key = value.split('=', 1)[0]?.trim();
  return (
    key === 'model' ||
    key === 'model_catalog_json' ||
    key === 'model_provider' ||
    key.startsWith('model_providers.')
  );
};

export const sanitizeCodexProviderBindingArgs = (source: string[]): string[] => {
  const args: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const arg = source[index];
    if (arg === '--model' || arg === '-m') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--model=') || arg.startsWith('-m=')) continue;
    if (arg === '--config' || arg === '-c') {
      const value = source[index + 1];
      if (value && isConflictingConfigOverride(value)) {
        index += 1;
        continue;
      }
    }
    if (
      (arg.startsWith('--config=') || arg.startsWith('-c=')) &&
      isConflictingConfigOverride(arg.slice(arg.indexOf('=') + 1))
    ) {
      continue;
    }
    args.push(arg);
  }
  return args;
};

const sanitizeCodexProviderBindingEnv = (source: Record<string, string> | undefined) => {
  const env = { ...source };
  delete env.CODEX_HOME;
  delete env.OPENAI_API_KEY;
  delete env[HOST_API_KEY_ENV];
  delete env[SERVER_TOKEN_ENV];
  return env;
};

const tomlString = (value: string): string => JSON.stringify(value);

const buildServerDefaultModelCatalog = (
  model: CodexServerDefaultModelMetadata,
  requestModel: string,
) => {
  const { compatibility } = model;
  const contextWindow = model.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  const displayName = model.displayName ?? requestModel;
  const supportedReasoningLevels = compatibility.reasoningEfforts.map((effort) => ({
    description: CODEX_REASONING_LEVEL_DESCRIPTIONS[effort] ?? `${effort} reasoning`,
    effort,
  }));

  return `${JSON.stringify(
    {
      models: [
        {
          // The relay bridge currently carries function tools. Keep patch editing
          // on the unified exec path instead of advertising a dropped custom tool.
          apply_patch_tool_type: null,
          availability_nux: null,
          base_instructions: CODEX_SERVER_DEFAULT_BASE_INSTRUCTIONS,
          context_window: contextWindow,
          default_reasoning_level: compatibility.defaultReasoningEffort,
          default_reasoning_summary: 'none',
          default_verbosity: null,
          description: model.description ?? displayName,
          display_name: displayName,
          effective_context_window_percent: 95,
          experimental_supported_tools: [],
          input_modalities: ['text'],
          max_context_window: contextWindow,
          priority: 0,
          shell_type: 'unified_exec',
          slug: requestModel,
          support_verbosity: false,
          supported_in_api: true,
          supported_reasoning_levels: supportedReasoningLevels,
          supports_reasoning_summary_parameter: false,
          truncation_policy: { limit: 10_000, mode: compatibility.truncationMode },
          upgrade: null,
          visibility: 'list',
        },
      ],
    },
    null,
    2,
  )}\n`;
};

const buildCodexOptionArgs = async ({
  args,
  helpers,
  promptInput,
}: Pick<HeterogeneousAgentBuildPlanParams, 'args' | 'helpers' | 'promptInput'>) => {
  const inputPlan = await helpers.buildAgentInput('codex', promptInput);
  const executionModeArgs = hasAnyFlag(args, CODEX_EXECUTION_MODE_FLAGS)
    ? []
    : [...CODEX_DEFAULT_EXECUTION_ARGS];

  return {
    args: [...CODEX_REQUIRED_ARGS, ...executionModeArgs, ...args, ...inputPlan.args],
    stdinPayload: inputPlan.stdin,
  };
};

export const codexDriver: HeterogeneousAgentDriver = {
  async buildSpawnPlan({
    args,
    helpers,
    promptInput,
    resumeSessionId,
  }: HeterogeneousAgentBuildPlanParams) {
    const { args: optionArgs, stdinPayload } = await buildCodexOptionArgs({
      args,
      helpers,
      promptInput,
    });

    return {
      args: resumeSessionId
        ? ['exec', 'resume', ...optionArgs, resumeSessionId, '-']
        : ['exec', ...optionArgs],
      stdinPayload,
    };
  },
  prepareProviderBinding({ args, env, profileDir, resolution }) {
    if (resolution.protocol !== 'openai-responses' || !resolution.endpoint) {
      throw new Error('Codex provider binding requires a Responses API endpoint.');
    }

    const apiKey = resolution.runtimeConfig.keyVaults.apiKey?.trim();
    if (!apiKey) throw new Error('Codex provider binding requires an API key.');

    const config = [
      `model_provider = ${tomlString(HOST_PROVIDER_ID)}`,
      '',
      `[model_providers.${HOST_PROVIDER_ID}]`,
      `name = ${tomlString('LobeHub Provider')}`,
      `base_url = ${tomlString(resolution.endpoint)}`,
      `env_key = ${tomlString(HOST_API_KEY_ENV)}`,
      'wire_api = "responses"',
      'requires_openai_auth = false',
      '',
    ].join('\n');

    return {
      args: [...sanitizeCodexProviderBindingArgs(args), '--model', resolution.apiConfig.model],
      env: {
        ...sanitizeCodexProviderBindingEnv(env),
        CODEX_HOME: profileDir,
        [HOST_API_KEY_ENV]: apiKey,
      },
      profileFiles: [{ content: config, path: 'config.toml' }],
    };
  },
  prepareServerDefaultBinding({ args, codexModel, endpoint, env, model, profileDir, runDir }) {
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    const modelCatalogPath = codexModel
      ? path.join(runDir, SERVER_DEFAULT_MODEL_CATALOG_FILE)
      : undefined;
    const config = [
      `model = ${tomlString(requestModel)}`,
      `model_provider = ${tomlString(HOST_PROVIDER_ID)}`,
      '',
      `[model_providers.${HOST_PROVIDER_ID}]`,
      `name = ${tomlString('LobeHub Server Default')}`,
      `base_url = ${tomlString(`${endpoint}/api/v1/openai/v1`)}`,
      `env_key = ${tomlString(SERVER_TOKEN_ENV)}`,
      'wire_api = "responses"',
      'requires_openai_auth = false',
      'supports_websockets = false',
      '',
    ].join('\n');
    return {
      args: [
        ...sanitizeCodexProviderBindingArgs(args),
        ...(modelCatalogPath
          ? ['--config', `model_catalog_json=${tomlString(modelCatalogPath)}`]
          : []),
        '--model',
        requestModel,
      ],
      env: { ...sanitizeCodexProviderBindingEnv(env), CODEX_HOME: profileDir },
      profileFiles: [{ content: config, path: 'config.toml' }],
      runFiles: codexModel
        ? [
            {
              content: buildServerDefaultModelCatalog(codexModel, requestModel),
              path: SERVER_DEFAULT_MODEL_CATALOG_FILE,
            },
          ]
        : undefined,
    };
  },
};
