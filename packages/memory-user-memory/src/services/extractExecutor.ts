import type { LobeChatDatabase } from '@lobechat/database';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  gateKeeperCallDurationHistogram,
  gateKeeperCallsCounter,
  layerCallDurationHistogram,
  layersCallsCounter,
  tracer,
} from '@lobechat/observability-otel/modules/memory-user-memory';
import { attributesCommon } from '@lobechat/observability-otel/node';
import { LayersEnum } from '@lobechat/types';

import {
  ActivityExtractor,
  ContextExtractor,
  ExperienceExtractor,
  IdentityExtractor,
  PreferenceExtractor,
  UserMemoryGateKeeper,
} from '../extractors';
import type {
  BaseExtractorDependencies,
  ExtractorOptions,
  ExtractorRunOptions,
  GatekeeperDecision,
  GatekeeperOptions,
  MemoryExtractionAgent,
  MemoryExtractionJob,
  MemoryExtractionLayerOutputs,
  MemoryExtractionLLMConfig,
  MemoryExtractionResult,
} from '../types';

const LAYER_ORDER: LayersEnum[] = [
  'activity' as LayersEnum,
  'identity' as LayersEnum,
  'context' as LayersEnum,
  'preference' as LayersEnum,
  'experience' as LayersEnum,
];

const LAYER_LABEL_MAP: Record<LayersEnum, string> = {
  activity: 'activities',
  context: 'contexts',
  experience: 'experiences',
  identity: 'identities',
  preference: 'preferences',
};

export interface MemoryExtractionRuntimeOptions {
  embeddings?: ModelRuntime;
  gatekeeper: ModelRuntime;
  layerExtractor: ModelRuntime;
}

export interface MemoryExtractionServiceOptions {
  callbacks?: ExtractorOptions['callbacks'];
  config: MemoryExtractionLLMConfig;
  db: LobeChatDatabase;
  language?: string;
  runtimes: MemoryExtractionRuntimeOptions;
}

export interface MemoryExtractionLayerOutputTypes {
  [LayersEnum.Activity]: Awaited<ReturnType<ActivityExtractor['structuredCall']>>;
  [LayersEnum.Context]: Awaited<ReturnType<ContextExtractor['structuredCall']>>;
  [LayersEnum.Experience]: Awaited<ReturnType<ExperienceExtractor['structuredCall']>>;
  [LayersEnum.Identity]: Awaited<ReturnType<IdentityExtractor['structuredCall']>>;
  [LayersEnum.Preference]: Awaited<ReturnType<PreferenceExtractor['structuredCall']>>;
}

export type MemoryExtractionLayerOutputType = {
  [K in keyof MemoryExtractionLayerOutputTypes]: MemoryExtractionLayerOutputTypes[K];
}[keyof MemoryExtractionLayerOutputTypes];

export class MemoryExtractionService<RO> {
  private readonly config: MemoryExtractionLLMConfig;

  private readonly gatekeeper: UserMemoryGateKeeper;

  private readonly identityExtractor: IdentityExtractor;
  private readonly contextExtractor: ContextExtractor;
  private readonly experienceExtractor: ExperienceExtractor;
  private readonly preferenceExtractor: PreferenceExtractor;
  private readonly activityExtractor: ActivityExtractor;

  private readonly gatekeeperRuntime: ModelRuntime;
  private readonly layerRuntime: ModelRuntime;

  constructor(options: MemoryExtractionServiceOptions) {
    this.config = options.config;
    this.gatekeeperRuntime = options.runtimes.gatekeeper;
    this.layerRuntime = options.runtimes.layerExtractor;

    const gatekeeperConfig: BaseExtractorDependencies = {
      agent: 'gatekeeper',
      model: this.config.gateModel,
      modelRuntime: this.gatekeeperRuntime,
    };

    this.gatekeeper = new UserMemoryGateKeeper(gatekeeperConfig);

    const buildExtractorConfig = (
      layer: LayersEnum,
      agent: MemoryExtractionAgent,
    ): BaseExtractorDependencies => {
      const model = this.config.layerModels[layer];
      if (!model) {
        throw new Error(`Missing model configuration for memory layer: ${layer}`);
      }

      return {
        agent,
        model,
        modelRuntime: this.layerRuntime,
      } satisfies BaseExtractorDependencies;
    };

    this.identityExtractor = new IdentityExtractor(
      buildExtractorConfig(LayersEnum.Identity, 'layer-identity'),
    );
    this.activityExtractor = new ActivityExtractor(
      buildExtractorConfig(LayersEnum.Activity, 'layer-activity'),
    );
    this.contextExtractor = new ContextExtractor(
      buildExtractorConfig(LayersEnum.Context, 'layer-context'),
    );
    this.experienceExtractor = new ExperienceExtractor(
      buildExtractorConfig(LayersEnum.Experience, 'layer-experience'),
    );
    this.preferenceExtractor = new PreferenceExtractor(
      buildExtractorConfig(LayersEnum.Preference, 'layer-preference'),
    );
  }

  private recordGatekeeperMetrics(
    job: MemoryExtractionJob,
    durationMs: number,
    status: 'ok' | 'error',
  ) {
    const attributes = {
      source: job.source,
      status,
      user_id: job.userId,
      ...attributesCommon(),
    };

    gateKeeperCallsCounter.add(1, attributes);
    gateKeeperCallDurationHistogram.record(durationMs, attributes);
  }

  private recordLayerCallMetrics(
    job: MemoryExtractionJob,
    layer: LayersEnum,
    durationMs: number,
    status: 'ok' | 'error',
  ) {
    const attributes = {
      layer: LAYER_LABEL_MAP[layer],
      source: job.source,
      status,
      user_id: job.userId,
      ...attributesCommon(),
    };

    layersCallsCounter.add(1, attributes);
    layerCallDurationHistogram.record(durationMs, attributes);
  }

  private async runLayerExtractor<T>(
    job: MemoryExtractionJob,
    layer: LayersEnum,
    extractor: () => Promise<T>,
  ): Promise<T> {
    const attributes = {
      layer: LAYER_LABEL_MAP[layer],
      source: job.source,
      source_id: job.sourceId,
      user_id: job.userId,
      ...attributesCommon(),
    };

    return tracer.startActiveSpan(
      `run${layer.charAt(0).toUpperCase() + layer.slice(1)}LayerExtractor`,
      { attributes },
      async (span) => {
        const start = Date.now();

        try {
          const result = await extractor();
          const duration = Date.now() - start;

          this.recordLayerCallMetrics(job, layer, duration, 'ok');
          span.setStatus({ code: SpanStatusCode.OK });

          return result;
        } catch (error) {
          const duration = Date.now() - start;

          this.recordLayerCallMetrics(job, layer, duration, 'error');
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Layer extraction failed',
          });
          span.recordException(error as Error);
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  async run(
    job: MemoryExtractionJob,
    options: ExtractorRunOptions<RO>,
  ): Promise<MemoryExtractionResult | null> {
    try {
      const decision = await this.runGatekeeper(job, { ...options });
      const layersToExtract = this.resolveJobLayers(decision, job.layers);
      const outputs = await this.runLayers(job, layersToExtract, { ...options });

      const processedLayersCount = {
        activity: outputs.activity?.data ? outputs.activity?.data?.memories?.length : 0,
        context: outputs.context?.data ? outputs.context?.data?.memories?.length : 0,
        experience: outputs.experience?.data ? outputs.experience?.data?.memories?.length : 0,
        identity: outputs.identity?.data
          ? (outputs.identity?.data?.add?.length || 0) +
            (outputs.identity?.data?.update?.length || 0) +
            (outputs.identity?.data?.remove?.length || 0)
          : 0,
        preference: outputs.preference?.data ? outputs.preference?.data?.memories?.length : 0,
      };
      const processedErrorsCount = {
        activity: outputs.activity?.error ? 1 : 0,
        context: outputs.context?.error ? 1 : 0,
        experience: outputs.experience?.error ? 1 : 0,
        identity: outputs.identity?.error ? 1 : 0,
        preference: outputs.preference?.error ? 1 : 0,
      };

      const processedCount = Object.values(processedLayersCount).reduce((a, b) => a + b, 0);

      return {
        decision,
        inputs: {
          retrievedContexts: options.retrievedContexts,
          retrievedIdentitiesContext: options.retrievedIdentitiesContext,
        },
        layers: layersToExtract,
        outputs,
        processedCounts: processedCount,
        processedErrorsCount: processedErrorsCount,
        processedLayersCount: processedLayersCount,
      };
    } catch (error) {
      await options?.resultRecorder?.recordFail?.(job, error as Error);
      throw error;
    }
  }

  private async runGatekeeper(
    job: MemoryExtractionJob,
    options: GatekeeperOptions,
  ): Promise<GatekeeperDecision> {
    const start = Date.now();

    try {
      const decision = await this.gatekeeper.check({
        callbacks: options.callbacks,
        gateKeeperLanguage: options.gateKeeperLanguage || 'English',
        retrievedContexts: options.retrievedContexts,
        topK: options.topK,
      });
      this.recordGatekeeperMetrics(job, Date.now() - start, 'ok');

      return decision;
    } catch (error) {
      this.recordGatekeeperMetrics(job, Date.now() - start, 'error');
      throw error;
    }
  }

  private async runContextLayer(job: MemoryExtractionJob, options: ExtractorOptions) {
    return this.runLayerExtractor(job, LayersEnum.Context, () =>
      this.contextExtractor.structuredCall({
        ...options,
        language: options.language ?? 'English',
      }),
    );
  }

  private async runActivityLayer(job: MemoryExtractionJob, options: ExtractorOptions) {
    return this.runLayerExtractor(job, LayersEnum.Activity, () =>
      this.activityExtractor.structuredCall({
        ...options,
        language: options.language ?? 'English',
      }),
    );
  }

  private async runExperienceLayer(job: MemoryExtractionJob, options: ExtractorOptions) {
    return this.runLayerExtractor(job, LayersEnum.Experience, () =>
      this.experienceExtractor.structuredCall({
        ...options,
        language: options.language ?? 'English',
      }),
    );
  }

  private async runPreferenceLayer(job: MemoryExtractionJob, options: ExtractorOptions) {
    return this.runLayerExtractor(job, LayersEnum.Preference, () =>
      this.preferenceExtractor.structuredCall({
        ...options,
        language: options.language ?? 'English',
      }),
    );
  }

  private async runIdentityLayer(
    job: MemoryExtractionJob,
    options: ExtractorOptions & {
      existingIdentitiesContext?: string;
    },
  ) {
    return this.runLayerExtractor(job, LayersEnum.Identity, () =>
      this.identityExtractor.structuredCall({
        ...options,
        language: options.language ?? 'English',
      }),
    );
  }

  private resolveLayers(decision: GatekeeperDecision): LayersEnum[] {
    return LAYER_ORDER.filter((layer) => decision[layer]?.shouldExtract);
  }

  private resolveJobLayers(decision: GatekeeperDecision, layers?: LayersEnum[]): LayersEnum[] {
    if (layers && layers.length > 0) {
      const requested = new Set<LayersEnum>(layers);

      return this.resolveLayers(decision).filter((layer) => requested.has(layer));
    }

    return this.resolveLayers(decision);
  }

  private async runLayers(
    job: MemoryExtractionJob,
    layers: LayersEnum[],
    options: ExtractorOptions & {
      existingIdentitiesContext?: string;
    },
  ): Promise<MemoryExtractionLayerOutputs> {
    const outputs: Partial<MemoryExtractionLayerOutputs> = {};

    const setLayerOutput = (
      layer: LayersEnum,
      result: { data: MemoryExtractionLayerOutputType } | { error: unknown },
    ) => {
      switch (layer) {
        case LayersEnum.Context: {
          outputs.context = result as
            | { data: MemoryExtractionLayerOutputTypes[typeof layer] }
            | { error: unknown };
          break;
        }
        case LayersEnum.Activity: {
          outputs.activity = result as
            | { data: MemoryExtractionLayerOutputTypes[typeof layer] }
            | { error: unknown };
          break;
        }
        case LayersEnum.Experience: {
          outputs.experience = result as
            | { data: MemoryExtractionLayerOutputTypes[typeof layer] }
            | { error: unknown };
          break;
        }
        case LayersEnum.Preference: {
          outputs.preference = result as
            | { data: MemoryExtractionLayerOutputTypes[typeof layer] }
            | { error: unknown };
          break;
        }
        case LayersEnum.Identity: {
          outputs.identity = result as
            | { data: MemoryExtractionLayerOutputTypes[typeof layer] }
            | { error: unknown };
          break;
        }
        default: {
          break;
        }
      }
    };

    await Promise.all(
      (
        [
          LayersEnum.Activity,
          LayersEnum.Context,
          LayersEnum.Experience,
          LayersEnum.Preference,
          LayersEnum.Identity,
        ] as LayersEnum[]
      ).map(async (layer) => {
        if (!layers.includes(layer)) {
          return;
        }

        try {
          const result = await this.runLayer(job, layer, options);
          setLayerOutput(layer, { data: result });
        } catch (error) {
          setLayerOutput(layer, { error });
        }
      }),
    );

    return outputs as MemoryExtractionLayerOutputs;
  }

  private async runLayer<L extends LayersEnum>(
    job: MemoryExtractionJob,
    layer: L,
    options: ExtractorOptions & {
      existingIdentitiesContext?: string;
    },
  ): Promise<MemoryExtractionLayerOutputType> {
    switch (layer) {
      case LayersEnum.Context: {
        return await this.runContextLayer(job, options);
      }
      case LayersEnum.Activity: {
        return await this.runActivityLayer(job, options);
      }
      case LayersEnum.Experience: {
        return await this.runExperienceLayer(job, options);
      }
      case LayersEnum.Preference: {
        return await this.runPreferenceLayer(job, options);
      }
      case LayersEnum.Identity: {
        return await this.runIdentityLayer(job, options);
      }
      default: {
        throw new Error(`Unsupported memory layer: ${layer}`);
      }
    }
  }
}
