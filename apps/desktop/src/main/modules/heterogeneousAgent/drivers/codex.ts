import path from 'node:path';

import {
  CODEX_DEFAULT_EXECUTION_ARGS,
  CODEX_EXECUTION_MODE_FLAGS,
  CODEX_REQUIRED_ARGS,
} from '@lobechat/heterogeneous-agents/spawn';
import type { CodexReasoningEffort, CodexServerDefaultCustomModel } from '@lobechat/types';
import {
  formatServerDefaultHeterogeneousModel,
  getCodexReasoningEffortLevels,
  isCodexServerDefaultCustomModel,
} from '@lobechat/types';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

const hasAnyFlag = (args: string[], flags: readonly string[]) =>
  args.some((arg) => flags.includes(arg as (typeof flags)[number]));

const HOST_PROVIDER_ID = 'lobehub';
const HOST_API_KEY_ENV = 'LOBEHUB_CODEX_API_KEY';
const SERVER_TOKEN_ENV = 'LOBEHUB_HETERO_TOKEN';
const SERVER_DEFAULT_MODEL_CATALOG_FILE = 'models.json';

interface CodexServerDefaultModelMetadata {
  contextWindow: number;
  defaultReasoningLevel: CodexReasoningEffort;
  description: string;
  displayName: string;
  truncationMode: 'bytes' | 'tokens';
}

const CODEX_SERVER_DEFAULT_MODEL_METADATA = {
  'deepseek-v4-flash': {
    contextWindow: 1_048_576,
    defaultReasoningLevel: 'high',
    description: 'Fast, cost-efficient DeepSeek V4 model for agentic coding.',
    displayName: 'DeepSeek V4 Flash',
    truncationMode: 'tokens',
  },
  'deepseek-v4-pro': {
    contextWindow: 1_048_576,
    defaultReasoningLevel: 'high',
    description: 'DeepSeek V4 flagship model for complex agentic coding tasks.',
    displayName: 'DeepSeek V4 Pro',
    truncationMode: 'tokens',
  },
  'glm-5.2': {
    contextWindow: 1_048_576,
    defaultReasoningLevel: 'max',
    description: 'GLM-5.2 flagship model for long-horizon engineering tasks.',
    displayName: 'GLM-5.2',
    truncationMode: 'bytes',
  },
} as const satisfies Record<CodexServerDefaultCustomModel, CodexServerDefaultModelMetadata>;

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
  model: CodexServerDefaultCustomModel,
  requestModel: string,
) => {
  const metadata = CODEX_SERVER_DEFAULT_MODEL_METADATA[model];
  const supportedReasoningLevels = getCodexReasoningEffortLevels(model).map((effort) => ({
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
          context_window: metadata.contextWindow,
          default_reasoning_level: metadata.defaultReasoningLevel,
          default_reasoning_summary: 'none',
          default_verbosity: null,
          description: metadata.description,
          display_name: metadata.displayName,
          effective_context_window_percent: 95,
          experimental_supported_tools: [],
          input_modalities: ['text'],
          max_context_window: metadata.contextWindow,
          priority: 0,
          shell_type: 'unified_exec',
          slug: requestModel,
          support_verbosity: false,
          supported_in_api: true,
          supported_reasoning_levels: supportedReasoningLevels,
          // Required by codex-cli's catalog schema — it has no serde default, so
          // omitting it fails the whole file to parse ("missing field
          // `supports_parallel_tool_calls`") before the agent ever starts, with
          // nothing in the message tying it to this builder.
          //
          // `true` because the relay genuinely fans out: the responses encoder
          // walks its whole tool map and emits one `function_call` output item
          // per call, each with its own `output_index`. Codex may also send
          // `parallel_tool_calls` back on the request; `normalizeResponsesRequest`
          // reads only the fields it knows, so that is dropped rather than
          // forwarded to an upstream that might reject it.
          supports_parallel_tool_calls: true,
          supports_reasoning_summary_parameter: false,
          truncation_policy: { limit: 10_000, mode: metadata.truncationMode },
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
  prepareServerDefaultBinding({ args, endpoint, env, model, profileDir }) {
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    const customModel = isCodexServerDefaultCustomModel(model) ? model : undefined;
    const modelCatalogPath = customModel
      ? path.join(profileDir, SERVER_DEFAULT_MODEL_CATALOG_FILE)
      : undefined;
    const config = [
      `model = ${tomlString(requestModel)}`,
      `model_provider = ${tomlString(HOST_PROVIDER_ID)}`,
      ...(modelCatalogPath ? [`model_catalog_json = ${tomlString(modelCatalogPath)}`] : []),
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
      args: [...sanitizeCodexProviderBindingArgs(args), '--model', requestModel],
      env: { ...sanitizeCodexProviderBindingEnv(env), CODEX_HOME: profileDir },
      operationTokenEnvKey: SERVER_TOKEN_ENV,
      profileFiles: [
        { content: config, path: 'config.toml' },
        ...(customModel
          ? [
              {
                content: buildServerDefaultModelCatalog(customModel, requestModel),
                path: SERVER_DEFAULT_MODEL_CATALOG_FILE,
              },
            ]
          : []),
      ],
    };
  },
};
