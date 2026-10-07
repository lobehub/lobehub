import path from 'node:path';

import {
  prepareCodexProviderBinding,
  sanitizeCodexProviderBindingArgs,
  sanitizeCodexProviderBindingEnv,
} from '@lobechat/heterogeneous-agents/codexProviderBinding';
import {
  CODEX_DEFAULT_EXECUTION_ARGS,
  CODEX_EXECUTION_MODE_FLAGS,
  CODEX_REQUIRED_ARGS,
} from '@lobechat/heterogeneous-agents/spawn';
import type {
  CodexReasoningEffort,
  CodexServerDefaultCustomModel,
  ServerDefaultHeterogeneousModelDescriptor,
} from '@lobechat/types';
import {
  formatServerDefaultHeterogeneousModel,
  getCodexReasoningEffortLevels,
  isCodexServerDefaultCustomModel,
} from '@lobechat/types';

import type { HeterogeneousAgentBuildPlanParams, HeterogeneousAgentDriver } from '../types';

export { sanitizeCodexProviderBindingArgs } from '@lobechat/heterogeneous-agents/codexProviderBinding';

const hasAnyFlag = (args: string[], flags: readonly string[]) =>
  args.some((arg) => flags.includes(arg as (typeof flags)[number]));

const HOST_PROVIDER_ID = 'lobehub';
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
  medium: 'Balanced reasoning for everyday tasks',
} as const satisfies Partial<Record<CodexReasoningEffort, string>>;

/** Used when the model card names no window, as Pi's binding does. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * The common `reasoning_effort` levels, for a reasoning model with no tuned
 * entry; finer ones (xhigh, max) only where a model is known to take them.
 */
const GENERIC_REASONING_LEVELS = ['low', 'medium', 'high'] as const;

/** An OpenAI model id: gpt-6-sol, o4-mini. */
const OPENAI_MODEL = /^(?:gpt-|o\d)/;

const CODEX_SERVER_DEFAULT_BASE_INSTRUCTIONS =
  'You are Codex, a coding agent working with the user in a shared workspace. Follow the provided instructions, use tools when helpful, verify your changes, and report results clearly.';

const tomlString = (value: string): string => JSON.stringify(value);

/**
 * Whether Codex ships its own catalog entry for the model, so none is written.
 * The deployment's word decides; without it, an OpenAI-looking id is assumed
 * native as before.
 */
const isNativeCodexModel = (
  model: string,
  descriptor: ServerDefaultHeterogeneousModelDescriptor | undefined,
) =>
  descriptor?.nativeResponses ??
  (!isCodexServerDefaultCustomModel(model) && OPENAI_MODEL.test(model));

/** Hand-tuned metadata when there is some, else the deployment's model card. */
const resolveServerDefaultModelMetadata = (
  model: string,
  descriptor: ServerDefaultHeterogeneousModelDescriptor | undefined,
) => {
  if (isCodexServerDefaultCustomModel(model)) {
    return {
      ...CODEX_SERVER_DEFAULT_MODEL_METADATA[model],
      inputModalities: ['text'],
      reasoningLevels: getCodexReasoningEffortLevels(model),
    };
  }

  const displayName = descriptor?.displayName?.trim() || model;
  const reasoningLevels: readonly CodexReasoningEffort[] = descriptor?.abilities.reasoning
    ? GENERIC_REASONING_LEVELS
    : [];
  return {
    contextWindow:
      descriptor?.contextWindowTokens && descriptor.contextWindowTokens > 0
        ? descriptor.contextWindowTokens
        : DEFAULT_CONTEXT_WINDOW,
    defaultReasoningLevel: reasoningLevels.length > 0 ? ('medium' as const) : null,
    description: `${displayName} via LobeHub.`,
    displayName,
    inputModalities: descriptor?.abilities.vision ? ['text', 'image'] : ['text'],
    reasoningLevels,
    truncationMode: 'tokens' as const,
  };
};

const buildServerDefaultModelCatalog = (
  model: string,
  requestModel: string,
  descriptor: ServerDefaultHeterogeneousModelDescriptor | undefined,
) => {
  const metadata = resolveServerDefaultModelMetadata(model, descriptor);
  const supportedReasoningLevels = metadata.reasoningLevels.map((effort) => ({
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
          input_modalities: metadata.inputModalities,
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
  prepareProviderBinding: prepareCodexProviderBinding,
  prepareServerDefaultBinding({ args, endpoint, env, model, modelDescriptor, profileDir }) {
    const requestModel = formatServerDefaultHeterogeneousModel(model);
    // Codex has entries for OpenAI's models only; any other model is described
    // to it, so every tool-capable relay model runs, new ones included.
    const writesCatalog = !isNativeCodexModel(model, modelDescriptor);
    const modelCatalogPath = writesCatalog
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
        ...(writesCatalog
          ? [
              {
                content: buildServerDefaultModelCatalog(model, requestModel, modelDescriptor),
                path: SERVER_DEFAULT_MODEL_CATALOG_FILE,
              },
            ]
          : []),
      ],
    };
  },
};
