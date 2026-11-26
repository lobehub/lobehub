/** Legacy Claude Code request alias. Current CLIs send `lobehub/${catalogId}`. */
export const SERVER_DEFAULT_HETEROGENEOUS_MODEL_ALIAS = 'lobehub-default';

const SERVER_DEFAULT_HETEROGENEOUS_MODEL_NAMESPACE = 'lobehub/';

/** Legacy ids a CLI reported for server-default runs, before the `lobehub/` namespace. */
const LEGACY_SERVER_DEFAULT_HETEROGENEOUS_MODELS = new Set([
  SERVER_DEFAULT_HETEROGENEOUS_MODEL_ALIAS,
  'custom:LobeHub-Server-Default-0',
]);

export const formatServerDefaultHeterogeneousModel = (model: string): string =>
  `${SERVER_DEFAULT_HETEROGENEOUS_MODEL_NAMESPACE}${model}`;

export const isServerDefaultHeterogeneousModel = (
  requestModel: unknown,
  operationModel: string,
): boolean => requestModel === formatServerDefaultHeterogeneousModel(operationModel);

/**
 * Model-card facts a CLI needs to describe a deployment model it has no
 * built-in entry for (context window, modalities, reasoning). Credential-free.
 */
export interface ServerDefaultHeterogeneousModelDescriptor {
  abilities: { reasoning: boolean; vision: boolean };
  contextWindowTokens?: number;
  displayName?: string;
  maxOutput?: number;
  model: string;
  /** Served on the OpenAI Responses API natively; Codex ships its own entry for it. */
  nativeResponses: boolean;
}

export interface ServerDefaultHeterogeneousRelayInvocation {
  acceptedAt: string;
  agentType: string;
  ingress: 'anthropic-messages' | 'openai-responses';
  model: string;
  operationId: string;
  provider: string;
}

/** Durable proof written only after the official relay accepts a model invocation. */
export const isServerDefaultHeterogeneousRelayInvocation = (
  value: unknown,
): value is ServerDefaultHeterogeneousRelayInvocation => {
  if (!value || typeof value !== 'object') return false;
  const invocation = value as Partial<ServerDefaultHeterogeneousRelayInvocation>;
  return (
    typeof invocation.acceptedAt === 'string' &&
    typeof invocation.agentType === 'string' &&
    ['anthropic-messages', 'openai-responses'].includes(invocation.ingress ?? '') &&
    typeof invocation.model === 'string' &&
    typeof invocation.operationId === 'string' &&
    typeof invocation.provider === 'string'
  );
};

/**
 * Whether a CLI-reported model came from a server-default run. Reads the model stored on the
 * message, so it stays right after the agent switches to or from server-default.
 */
export const isServerDefaultHeterogeneousReportedModel = (reportedModel: string | undefined) =>
  !!reportedModel &&
  (LEGACY_SERVER_DEFAULT_HETEROGENEOUS_MODELS.has(reportedModel) ||
    reportedModel.startsWith(SERVER_DEFAULT_HETEROGENEOUS_MODEL_NAMESPACE));

/** Provider that serves server-default runs; the `lobehub/` model namespace names it. */
export const SERVER_DEFAULT_HETEROGENEOUS_PROVIDER = 'lobehub';

/**
 * Rewrite a server-default run's CLI report into what its message stores: the catalog model
 * and {@link SERVER_DEFAULT_HETEROGENEOUS_PROVIDER} instead of the CLI type. The stored
 * provider is the run's durable provenance, since the catalog id alone no longer shows the
 * run was server-default once the agent switches away from it. Returns `undefined` when
 * nothing changes.
 */
export const stampServerDefaultHeterogeneousReport = <
  T extends { model?: unknown; provider?: unknown },
>(
  data: T | undefined,
  configuredModel: string,
): T | undefined => {
  if (!data) return;
  const model =
    typeof data.model === 'string'
      ? unwrapServerDefaultHeterogeneousModel(data.model, configuredModel)
      : data.model;
  const provider =
    typeof data.provider === 'string' ? SERVER_DEFAULT_HETEROGENEOUS_PROVIDER : data.provider;
  if (model === data.model && provider === data.provider) return;
  return { ...data, model, provider };
};

/**
 * Map a CLI-reported server-default model back to the catalog id.
 *
 * Supported CLIs request `lobehub/${catalogId}`. Older Claude Code sessions used
 * {@link SERVER_DEFAULT_HETEROGENEOUS_MODEL_ALIAS}. Neither is the catalog id
 * the user picked.
 */
export const unwrapServerDefaultHeterogeneousModel = (
  reportedModel: string | undefined,
  configuredModel?: string,
): string | undefined => {
  const configured = configuredModel?.trim() || undefined;

  if (!reportedModel) return configured;

  if (LEGACY_SERVER_DEFAULT_HETEROGENEOUS_MODELS.has(reportedModel)) {
    return configured ?? reportedModel;
  }

  if (reportedModel.startsWith(SERVER_DEFAULT_HETEROGENEOUS_MODEL_NAMESPACE)) {
    const unwrapped = reportedModel.slice(SERVER_DEFAULT_HETEROGENEOUS_MODEL_NAMESPACE.length);
    return unwrapped || reportedModel;
  }

  return reportedModel;
};
