import { readFrozenModelFacts } from '@lobechat/mecha';
import debug from 'debug';
import type { ModelAbilities } from 'model-bank';

import type { loadModels } from '@/business/client/model-bank/loadModels';
import { AiModelModel } from '@/database/models/aiModel';
import { AiProviderModel } from '@/database/models/aiProvider';
import { resolveModelMediaCapabilities } from '@/server/modules/AgentRuntime/resolveModelMediaCapabilities';
import {
  createServerModelParamsProviders,
  toUserModelRowFacts,
} from '@/server/modules/Mecha/ModelParams/providers';

import { resolveServerSearchDecision } from '../../searchDecision';
import type { ExecRunContext } from '../../types';
import { markDegradedStage, traceDiscoveryStage } from '../discoveryTracing';
import type { ToolDiscoveryDeps } from './types';

const log = debug('lobe-server:ai-agent-service');

type BuiltinModels = Awaited<ReturnType<typeof loadModels>>;

/**
 * Started, not awaited: the tool reads hit other backends entirely, so this
 * round trip overlaps them instead of gating them.
 */
export const startModelMetadataRead = (deps: ToolDiscoveryDeps, model: string, provider: string) =>
  traceDiscoveryStage('model_metadata', async (span) => {
    const results = await Promise.allSettled([
      new AiModelModel(deps.db, deps.userId, deps.workspaceId).findByIdAndProvider(model, provider),
      new AiProviderModel(deps.db, deps.userId, deps.workspaceId).findById(provider),
    ]);
    markDegradedStage(
      span,
      results.filter((result) => result.status === 'rejected').length,
      'metadata lookups',
    );
    return results;
  });

/**
 * The run's model facts, read here because this stage already holds the loaded
 * bank and the user's model row: media capabilities, the frozen model facts and
 * the server search decision.
 */
export const resolveModelContext = async (
  deps: ToolDiscoveryDeps,
  ctx: Pick<ExecRunContext, 'agentConfig' | 'model' | 'provider' | 'topicId'>,
  builtinModels: BuiltinModels,
  modelMetadataTask: ReturnType<typeof startModelMetadataRead>,
) => {
  const { agentConfig, model, provider, topicId } = ctx;
  const [modelMetadataResult, providerMetadataResult] = await modelMetadataTask;
  if (modelMetadataResult.status === 'rejected') {
    log('execAgent: failed to load active model search metadata: %O', modelMetadataResult.reason);
  }
  if (providerMetadataResult.status === 'rejected') {
    log(
      'execAgent: failed to load active provider search metadata: %O',
      providerMetadataResult.reason,
    );
  }
  const activeModelMetadata =
    modelMetadataResult.status === 'fulfilled' ? modelMetadataResult.value : undefined;
  const activeProviderMetadata =
    providerMetadataResult.status === 'fulfilled' ? providerMetadataResult.value : undefined;
  const activeModelAbilities = activeModelMetadata?.abilities as ModelAbilities | undefined;
  const modelMediaCapabilities =
    resolveModelMediaCapabilities({
      builtinModels,
      model,
      provider,
      userAbilities: activeModelAbilities,
    }) ?? {};
  // Everything downstream — one per step, retries included — reads these back
  // off the operation instead.
  const modelFacts = await readFrozenModelFacts(
    {
      agent: { id: agentConfig.id },
      mediaCapabilities: modelMediaCapabilities,
      model,
      provider,
      topicId,
    },
    {
      ...createServerModelParamsProviders({
        builtinModels,
        serverDB: deps.db,
        userId: deps.userId,
        workspaceId: deps.workspaceId,
      }),
      // Reuse the row read above rather than querying it a second time.
      getUserModelRow: async () =>
        activeModelMetadata ? toUserModelRowFacts(activeModelMetadata) : null,
    },
  );
  const searchDecision = resolveServerSearchDecision({
    builtinModels,
    chatConfig: agentConfig.chatConfig ?? undefined,
    hasModelAbilitiesOverride:
      !!activeModelAbilities && Object.keys(activeModelAbilities).length > 0,
    model,
    modelSearchAbility: activeModelAbilities?.search,
    modelSearchImpl: activeModelMetadata?.settings?.searchImpl,
    provider,
    providerSearchMode: activeProviderMetadata?.settings?.searchMode,
  });

  return { modelFacts, modelMediaCapabilities, searchDecision };
};
