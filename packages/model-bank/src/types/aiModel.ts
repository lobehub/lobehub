import { z } from 'zod';

import { type ModelParamsSchema, type VideoModelParamsSchema } from '../standard-parameters';

export type ModelPriceCurrency = 'CNY' | 'USD';

export const AiModelSourceEnum = {
  Builtin: 'builtin',
  Custom: 'custom',
  Remote: 'remote',
} as const;

export type AiModelSourceType = (typeof AiModelSourceEnum)[keyof typeof AiModelSourceEnum];

export const AiModelTypeSchema = z.enum([
  'chat',
  'embedding',
  'tts',
  'asr',
  'image',
  'video',
  'text2music',
  'realtime',
] as const);

export type AiModelType = z.infer<typeof AiModelTypeSchema>;

/**
 * The speech-to-text model type was renamed from the legacy `stt` to the
 * standard `asr`. Instead of a bulk DB data migration, persisted rows and
 * external API inputs are normalized at the read/write boundary — only data
 * that is actually touched gets converted, old untouched rows stay valid.
 */
export const normalizeAiModelType = <T extends string | null | undefined>(type: T): T =>
  (type === 'stt' ? 'asr' : type) as T;

export interface ModelAbilities {
  /**
   * whether model supports audio input understanding
   */
  audio?: boolean;
  /**
   * whether model supports file upload
   */
  files?: boolean;
  /**
   * whether model supports function call
   */
  functionCall?: boolean;
  /**
   * whether model supports image output
   */
  imageOutput?: boolean;
  /**
   * whether model supports reasoning
   */
  reasoning?: boolean;
  /**
   * whether model supports search web
   */
  search?: boolean;
  /**
   * whether model supports structured output
   */
  structuredOutput?: boolean;
  /**
   * whether model supports video
   */
  video?: boolean;
  /**
   *  whether model supports vision
   */
  vision?: boolean;
}

const AiModelAbilitiesSchema = z.object({
  audio: z.boolean().optional(),
  // files: z.boolean().optional(),
  functionCall: z.boolean().optional(),
  imageOutput: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  search: z.boolean().optional(),
  video: z.boolean().optional(),
  vision: z.boolean().optional(),
});

// Language model configuration parameters
export interface LLMParams {
  /**
   * Controls the penalty coefficient in generated text to reduce repetition
   * @default 0
   */
  frequency_penalty?: number;
  /**
   * Maximum length of generated text
   */
  max_tokens?: number;
  /**
   * Controls the penalty coefficient in generated text to reduce topic variation
   * @default 0
   */
  presence_penalty?: number;
  /**
   * Random measure for generated text to control creativity and diversity
   * @default 1
   */
  reasoning_effort?: string;
  /**
   * Random measure for generated text to control creativity and diversity
   * @default 1
   */
  temperature?: number;
  /**
   * Controls the single token with highest probability in generated text
   * @default 1
   */
  top_p?: number;
}

export interface BasicModelPricing {
  /**
   * the currency of the pricing
   * @default USD
   */
  currency?: ModelPriceCurrency;
  /**
   * the input pricing, e.g. $1 / 1M tokens
   */
  input?: number;
}

export interface ChatModelPricing extends BasicModelPricing {
  audioInput?: number;
  audioOutput?: number;
  cachedAudioInput?: number;
  cachedInput?: number;
  /**
   * the output pricing, e.g. $2 / 1M tokens
   */
  output?: number;
  writeCacheInput?: number;
}

// New pricing system types
export type PricingUnitName =
  // Text-based pricing units
  | 'textInput' // corresponds to ChatModelPricing.input
  | 'textOutput' // corresponds to ChatModelPricing.output
  | 'textInput_cacheRead' // corresponds to ChatModelPricing.cachedInput
  | 'textInput_cacheWrite' // corresponds to ChatModelPricing.writeCacheInput

  // Audio-based pricing units
  | 'audioInput' // corresponds to ChatModelPricing.audioInput
  | 'audioOutput' // corresponds to ChatModelPricing.audioOutput
  | 'audioInput_cacheRead' // corresponds to ChatModelPricing.cachedAudioInput

  // Image-based pricing units
  | 'imageGeneration' // for image generation models
  | 'imageInput'
  | 'imageInput_cacheRead'
  | 'imageOutput'

  // Video-based pricing units
  | 'videoInput'
  | 'videoGeneration';

export type PricingUnitType =
  | 'millionTokens' // per 1M tokens
  | 'millionCharacters' // per 1M characters
  | 'image' // per image
  | 'video' // per video
  | 'megapixel' // per megapixel
  | 'second'; // per second

export type PricingStrategy = 'fixed' | 'tiered' | 'lookup';

export interface PricingUnitBase {
  name: PricingUnitName;
  strategy: PricingStrategy;
  unit: PricingUnitType;
}

export interface FixedPricingUnit extends PricingUnitBase {
  /**
   * Original display price before discounts. Billing and cost calculation use `rate`.
   */
  originalRate?: number;
  rate: number;
  strategy: 'fixed';
}

export interface TieredPricingUnit extends PricingUnitBase {
  strategy: 'tiered';
  tiers: Array<{
    /**
     * Original display price before discounts. Billing and cost calculation use `rate`.
     */
    originalRate?: number;
    rate: number;
    upTo: number | 'infinity';
  }>;
}

export interface LookupPricingUnit extends PricingUnitBase {
  lookup: {
    /**
     * Original display prices before discounts. Billing and cost calculation use `prices`.
     */
    originalPrices?: Record<string, number>;
    prices: Record<string, number>;
    pricingParams: string[];
  };
  strategy: 'lookup';
}

export type PricingUnit = FixedPricingUnit | TieredPricingUnit | LookupPricingUnit;

export interface Pricing {
  /**
   * Fallback approximate per-image price (USD) when detailed pricing table is unavailable
   */
  approximatePricePerImage?: number;
  /**
   * Fallback approximate per-video price (USD) when detailed pricing table is unavailable
   */
  approximatePricePerVideo?: number;
  /**
   * Positive model-specific audio input token rate used for duration-based pre-flight estimates.
   * Authoritative billing continues to use provider-reported usage.
   */
  audioTokensPerSecond?: number;
  currency?: ModelPriceCurrency;
  units: PricingUnit[];
}

/**
 * Where a benchmark dimension's raw value comes from. `lobehub` marks values
 * derived from our own data (e.g. the price axis) rather than an external board.
 */
export type ModelRatingSource = 'artificial-analysis' | 'design-arena' | 'lmarena' | 'lobehub';

export interface ModelBenchmarkScore {
  /**
   * raw value from the source platform (index points / Elo / tokens per second /
   * credits per million tokens), kept for tooltips and offline re-normalization
   */
  raw?: number;
  /**
   * normalized 0-100 score; semantics are pool-relative (the strongest model in
   * the rated pool scores 100 on that dimension), not an absolute capability value
   */
  score: number;
  source: ModelRatingSource;
  /** click-through target showing the source leaderboard */
  sourceUrl: string;
  /** date the raw value was collected (YYYY-MM-DD) */
  updatedAt: string;
}

/**
 * Per-dimension benchmark ratings rendered as a radar chart. Every dimension is
 * optional — external leaderboards lag behind new models, so the UI must handle
 * missing dimensions (grey them out / skip the radar below a coverage threshold).
 */
export interface ModelRating {
  agentic?: ModelBenchmarkScore;
  design?: ModelBenchmarkScore;
  intelligence?: ModelBenchmarkScore;
  price?: ModelBenchmarkScore;
  speed?: ModelBenchmarkScore;
  writing?: ModelBenchmarkScore;
}

export interface AIBaseModelCard {
  /**
   * the context window (or input + output tokens limit)
   */
  contextWindowTokens?: number;
  description?: string;
  /**
   * the name show for end user
   */
  displayName?: string;
  enabled?: boolean;
  /**
   * product-line lineage, finer than `organization` (e.g. 'claude-opus',
   * 'claude-mythos', 'gpt', 'o-series', 'qwen'). Families contain generations;
   * lets the UI group models and match the same model across aggregator providers.
   */
  family?: string;
  /**
   * model generation within the family (e.g. 'claude-4.6', 'gpt-5.2', 'qwen3.5').
   * Only set when confidently derivable from the model line's naming.
   */
  generation?: string;
  id: string;
  /**
   * knowledge cutoff date (YYYY-MM). When the provider distinguishes a "reliable
   * knowledge cutoff" from the broader training-data cutoff, use the reliable one.
   */
  knowledgeCutoff?: string;
  /**
   * whether model is legacy (deprecated but not removed yet)
   */
  legacy?: boolean;
  maxOutput?: number;
  /**
   * who create this model
   */
  organization?: string;

  releasedAt?: string;
  /**
   * Whether the model should be shown in user-facing model lists.
   * Runtime-only aliases can set this to false while staying enabled and resolvable.
   */
  visible?: boolean;
}

export const isAiModelVisible = (model: { visible?: boolean }) => model.visible !== false;

/**
 * User-level default reasoning params for a model instance (userId + providerId + modelId),
 * stored under `ai_models.config.chatConfig` on the personal-scope row (workspaceId IS NULL).
 *
 * Field names intentionally mirror the same-named `LobeAgentChatConfig` fields so
 * `applyModelExtendParams` can consume this object unchanged. Deliberately narrow:
 * only the reasoning-effort family + `reasoningMode` — other extend params
 * (textVerbosity, thinking budget/level, ...) remain agent-scoped for now.
 */
export interface AiModelReasoningConfig {
  codexMaxReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  deepseekV4GAReasoningEffort?: 'none' | 'low' | 'high' | 'max';
  deepseekV4ReasoningEffort?: 'none' | 'high' | 'max';
  effort?: 'low' | 'medium' | 'high' | 'max';
  glm5_2ReasoningEffort?: 'high' | 'max';
  glm5_3ReasoningEffort?: 'low' | 'high' | 'max';
  gpt5_1ReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  gpt5_2ProReasoningEffort?: 'medium' | 'high' | 'xhigh';
  gpt5_2ReasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  gpt5_6ReasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  gpt5ReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  grok4_3ReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  grok4_5ReasoningEffort?: 'low' | 'medium' | 'high';
  grok4_6ReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  grok4_20ReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  hy3ReasoningEffort?: 'no_think' | 'low' | 'high';
  kimiK3ReasoningEffort?: 'low' | 'high' | 'max';
  opus47Effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  reasoningEffort?: 'low' | 'medium' | 'high';
  reasoningMode?: 'standard' | 'pro';
  ring2_6ReasoningEffort?: 'high' | 'xhigh';
  step3_5ReasoningEffort?: 'low' | 'high';
}

export const AiModelReasoningConfigSchema = z.object({
  codexMaxReasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
  deepseekV4GAReasoningEffort: z.enum(['none', 'low', 'high', 'max']).optional(),
  deepseekV4ReasoningEffort: z.enum(['none', 'high', 'max']).optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  glm5_2ReasoningEffort: z.enum(['high', 'max']).optional(),
  glm5_3ReasoningEffort: z.enum(['low', 'high', 'max']).optional(),
  gpt5_1ReasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  gpt5_2ProReasoningEffort: z.enum(['medium', 'high', 'xhigh']).optional(),
  gpt5_2ReasoningEffort: z.enum(['none', 'low', 'medium', 'high', 'xhigh']).optional(),
  gpt5_6ReasoningEffort: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  gpt5ReasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
  grok4_3ReasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
  grok4_5ReasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  grok4_6ReasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
  grok4_20ReasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
  hy3ReasoningEffort: z.enum(['no_think', 'low', 'high']).optional(),
  kimiK3ReasoningEffort: z.enum(['low', 'high', 'max']).optional(),
  opus47Effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  reasoningMode: z.enum(['standard', 'pro']).optional(),
  ring2_6ReasoningEffort: z.enum(['high', 'xhigh']).optional(),
  step3_5ReasoningEffort: z.enum(['low', 'high']).optional(),
});

/**
 * The extend params covered by AiModelReasoningConfig. Each entry is both an
 * ExtendParamsType value and the AiModelReasoningConfig key it reads from —
 * used to filter which model-instance defaults a given model actually supports.
 */
export const MODEL_REASONING_EXTEND_PARAMS = Object.keys(
  AiModelReasoningConfigSchema.shape,
) as (keyof AiModelReasoningConfig)[];

/**
 * Ordered level list per reasoning param (low → high), mirroring the
 * ControlsForm slider level definitions so select-style controls can render
 * the same choices.
 */
export const MODEL_REASONING_PARAM_LEVELS: {
  [K in keyof AiModelReasoningConfig]-?: readonly NonNullable<AiModelReasoningConfig[K]>[];
} = {
  codexMaxReasoningEffort: ['low', 'medium', 'high', 'xhigh'],
  deepseekV4GAReasoningEffort: ['none', 'low', 'high', 'max'],
  deepseekV4ReasoningEffort: ['none', 'high', 'max'],
  effort: ['low', 'medium', 'high', 'max'],
  glm5_2ReasoningEffort: ['high', 'max'],
  glm5_3ReasoningEffort: ['low', 'high', 'max'],
  gpt5_1ReasoningEffort: ['none', 'low', 'medium', 'high'],
  gpt5_2ProReasoningEffort: ['medium', 'high', 'xhigh'],
  gpt5_2ReasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh'],
  gpt5_6ReasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  gpt5ReasoningEffort: ['minimal', 'low', 'medium', 'high'],
  grok4_3ReasoningEffort: ['none', 'low', 'medium', 'high'],
  grok4_5ReasoningEffort: ['low', 'medium', 'high'],
  grok4_6ReasoningEffort: ['low', 'medium', 'high', 'xhigh'],
  grok4_20ReasoningEffort: ['low', 'medium', 'high', 'xhigh'],
  hy3ReasoningEffort: ['no_think', 'low', 'high'],
  kimiK3ReasoningEffort: ['low', 'high', 'max'],
  opus47Effort: ['low', 'medium', 'high', 'xhigh', 'max'],
  reasoningEffort: ['low', 'medium', 'high'],
  reasoningMode: ['standard', 'pro'],
  ring2_6ReasoningEffort: ['high', 'xhigh'],
  step3_5ReasoningEffort: ['low', 'high'],
};

/**
 * Fallback level shown when the user has not saved a model-instance value,
 * mirroring each ControlsForm slider's defaultValue (gpt5_2ReasoningEffort is
 * model-dependent there: 'medium' for gpt-5.5, 'none' otherwise).
 */
export const MODEL_REASONING_PARAM_DEFAULTS: {
  [K in keyof AiModelReasoningConfig]-?: NonNullable<AiModelReasoningConfig[K]>;
} = {
  codexMaxReasoningEffort: 'medium',
  deepseekV4GAReasoningEffort: 'high',
  deepseekV4ReasoningEffort: 'high',
  effort: 'high',
  glm5_2ReasoningEffort: 'max',
  glm5_3ReasoningEffort: 'max',
  gpt5_1ReasoningEffort: 'none',
  gpt5_2ProReasoningEffort: 'medium',
  gpt5_2ReasoningEffort: 'none',
  gpt5_6ReasoningEffort: 'medium',
  gpt5ReasoningEffort: 'medium',
  grok4_3ReasoningEffort: 'low',
  grok4_5ReasoningEffort: 'high',
  grok4_6ReasoningEffort: 'high',
  grok4_20ReasoningEffort: 'medium',
  hy3ReasoningEffort: 'high',
  kimiK3ReasoningEffort: 'max',
  opus47Effort: 'high',
  reasoningEffort: 'medium',
  reasoningMode: 'standard',
  ring2_6ReasoningEffort: 'high',
  step3_5ReasoningEffort: 'low',
};

export interface AiModelConfig {
  /**
   * User-level default reasoning params for this model instance; see
   * AiModelReasoningConfig. Not synced from remote model lists.
   */
  chatConfig?: AiModelReasoningConfig;

  /**
   * used in azure and volcengine
   */
  deploymentName?: string;

  /**
   * qwen series model enabled search
   */
  enabledSearch?: boolean;
}

export type ModelSearchImplementType = 'tool' | 'params' | 'internal';

export type ExtendParamsType =
  | 'reasoningBudgetToken'
  | 'reasoningBudgetToken32k'
  | 'reasoningBudgetToken80k'
  | 'enableReasoning'
  | 'preserveThinking'
  | 'enableAdaptiveThinking'
  | 'disableContextCaching'
  | 'effort'
  | 'deepseekV4GAReasoningEffort'
  | 'deepseekV4ReasoningEffort'
  | 'reasoningEffort'
  | 'reasoningMode'
  | 'gpt5ReasoningEffort'
  | 'gpt5_1ReasoningEffort'
  | 'gpt5_2ReasoningEffort'
  | 'gpt5_2ProReasoningEffort'
  | 'gpt5_6ReasoningEffort'
  | 'glm5_2ReasoningEffort'
  | 'glm5_3ReasoningEffort'
  | 'grok4_20ReasoningEffort'
  | 'grok4_3ReasoningEffort'
  | 'grok4_5ReasoningEffort'
  | 'grok4_6ReasoningEffort'
  | 'hy3ReasoningEffort'
  | 'kimiK3ReasoningEffort'
  | 'ring2_6ReasoningEffort'
  | 'codexMaxReasoningEffort'
  | 'opus47Effort'
  | 'step3_5ReasoningEffort'
  | 'textVerbosity'
  | 'thinking'
  | 'thinkingBudget'
  | 'thinkingLevel'
  | 'thinkingLevel2'
  | 'thinkingLevel3'
  | 'thinkingLevel4'
  | 'imageAspectRatio'
  | 'imageAspectRatio2'
  | 'imageResolution'
  | 'imageResolution2'
  | 'urlContext';

export type DisabledParamType = 'temperature' | 'top_p' | 'frequency_penalty' | 'presence_penalty';

export interface AiModelSettings {
  /**
   * Chat params that should be hidden from the agent config UI and stripped from
   * outbound requests. Use this for models whose API rejects specific sampling
   * params (e.g. Claude Opus 4.7 returns 400 on any non-default temperature / top_p).
   */
  disabledParams?: DisabledParamType[];
  extendParams?: ExtendParamsType[];
  /**
   * How the model layer implements search
   */
  searchImpl?: ModelSearchImplementType;
  searchProvider?: string;
}

export const ExtendParamsTypeSchema = z.enum([
  'reasoningBudgetToken',
  'reasoningBudgetToken32k',
  'reasoningBudgetToken80k',
  'enableReasoning',
  'preserveThinking',
  'enableAdaptiveThinking',
  'disableContextCaching',
  'effort',
  'deepseekV4GAReasoningEffort',
  'deepseekV4ReasoningEffort',
  'reasoningEffort',
  'reasoningMode',
  'gpt5ReasoningEffort',
  'gpt5_1ReasoningEffort',
  'gpt5_2ReasoningEffort',
  'gpt5_2ProReasoningEffort',
  'gpt5_6ReasoningEffort',
  'glm5_2ReasoningEffort',
  'glm5_3ReasoningEffort',
  'grok4_20ReasoningEffort',
  'grok4_3ReasoningEffort',
  'grok4_5ReasoningEffort',
  'grok4_6ReasoningEffort',
  'hy3ReasoningEffort',
  'kimiK3ReasoningEffort',
  'ring2_6ReasoningEffort',
  'codexMaxReasoningEffort',
  'opus47Effort',
  'step3_5ReasoningEffort',
  'textVerbosity',
  'thinking',
  'thinkingBudget',
  'thinkingLevel',
  'thinkingLevel2',
  'thinkingLevel3',
  'thinkingLevel4',
  'imageAspectRatio',
  'imageAspectRatio2',
  'imageResolution',
  'imageResolution2',
  'urlContext',
]);

export const ModelSearchImplementTypeSchema = z.enum(['tool', 'params', 'internal']);

export const DisabledParamTypeSchema = z.enum([
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
]);

export const AiModelSettingsSchema = z.object({
  disabledParams: z.array(DisabledParamTypeSchema).optional(),
  extendParams: z.array(ExtendParamsTypeSchema).optional(),
  searchImpl: ModelSearchImplementTypeSchema.optional(),
  searchProvider: z.string().optional(),
});

export interface AIChatModelCard extends AIBaseModelCard {
  abilities?: ModelAbilities;
  config?: AiModelConfig;
  maxOutput?: number;
  pricing?: Pricing;
  settings?: AiModelSettings;
  type: 'chat';
}

export interface AIEmbeddingModelCard extends AIBaseModelCard {
  maxDimension: number;
  pricing?: Pricing;
  type: 'embedding';
}

export interface AIImageModelCard extends AIBaseModelCard {
  parameters?: ModelParamsSchema;
  pricing?: Pricing;
  resolutions?: string[];
  type: 'image';
}

export interface AIVideoModelCard extends AIBaseModelCard {
  parameters?: VideoModelParamsSchema;
  pricing?: Pricing;
  type: 'video';
}

export interface AITTSModelCard extends AIBaseModelCard {
  pricing?: Pricing;
  type: 'tts';
}

export interface AIASRModelCard extends AIBaseModelCard {
  pricing?: Pricing;
  type: 'asr';
}

export interface AIRealtimeModelCard extends AIBaseModelCard {
  abilities?: {
    /**
     * whether model supports file upload
     */
    files?: boolean;
    /**
     * whether model supports function call
     */
    functionCall?: boolean;
    /**
     *  whether model supports reasoning
     */
    reasoning?: boolean;
    /**
     *  whether model supports vision
     */
    vision?: boolean;
  };
  /**
   * used in azure and volcengine
   */
  deploymentName?: string;
  maxOutput?: number;
  pricing?: Pricing;
  type: 'realtime';
}

export interface AiFullModelCard extends AIBaseModelCard {
  abilities?: ModelAbilities;
  config?: AiModelConfig;
  contextWindowTokens?: number;
  displayName?: string;
  id: string;
  maxDimension?: number;
  parameters?: ModelParamsSchema;
  pricing?: Pricing;
  settings?: AiModelSettings;
  type: AiModelType;
}

export interface LobeDefaultAiModelListItem extends AiFullModelCard {
  abilities: ModelAbilities;
  providerId: string;
}

// create
export const CreateAiModelSchema = z.object({
  abilities: AiModelAbilitiesSchema.optional(),
  contextWindowTokens: z.number().optional(),
  displayName: z.string().optional(),
  id: z.string(),
  providerId: z.string(),
  releasedAt: z.string().optional(),
  settings: AiModelSettingsSchema.optional(),
  type: AiModelTypeSchema.optional(),

  // checkModel: z.string().optional(),
  // homeUrl: z.string().optional(),
  // modelsUrl: z.string().optional(),
});

export type CreateAiModelParams = z.infer<typeof CreateAiModelSchema>;

// List Query

export interface AiProviderModelListItem {
  abilities?: ModelAbilities;
  config?: AiModelConfig;
  contextWindowTokens?: number;
  description?: string;
  displayName?: string;
  enabled: boolean;
  family?: string;
  generation?: string;
  id: string;
  knowledgeCutoff?: string;
  parameters?: ModelParamsSchema;
  pricing?: Pricing;
  releasedAt?: string;
  settings?: AiModelSettings;
  source?: AiModelSourceType;
  type: AiModelType;
  visible?: boolean;
}

// Update
export const UpdateAiModelSchema = z.object({
  abilities: AiModelAbilitiesSchema.optional(),
  // NOTE: `chatConfig` is deliberately NOT accepted here — model-instance reasoning
  // defaults go through the dedicated updateAiModelReasoningConfig procedure so the
  // generic update path can never carry (and thus never stomp) that namespace.
  config: z
    .object({
      deploymentName: z.string().optional(),
    })
    .optional(),
  contextWindowTokens: z.number().nullish(),
  displayName: z.string().nullish(),
  settings: AiModelSettingsSchema.optional(),
  type: AiModelTypeSchema.optional(),
});

export type UpdateAiModelParams = z.infer<typeof UpdateAiModelSchema>;

export interface AiModelSortMap {
  id: string;
  sort: number;
  type?: AiModelType;
}

export const ToggleAiModelEnableSchema = z.object({
  enabled: z.boolean(),
  id: z.string(),
  providerId: z.string(),
  source: z.enum(['builtin', 'custom', 'remote']).optional(),
  type: AiModelTypeSchema.optional(),
});

export type ToggleAiModelEnableParams = z.infer<typeof ToggleAiModelEnableSchema>;

export interface AiModelForSelect {
  abilities: ModelAbilities;
  /**
   * Approximate per-image price (USD), used when exact calculation is not possible
   */
  approximatePricePerImage?: number;
  /**
   * Approximate per-video price (USD), used when exact calculation is not possible
   */
  approximatePricePerVideo?: number;
  contextWindowTokens?: number;
  description?: string;
  displayName?: string;
  family?: string;
  generation?: string;
  id: string;
  knowledgeCutoff?: string;
  parameters?: ModelParamsSchema;
  /**
   * Exact per-image price (USD) calculated from pricing units
   */
  pricePerImage?: number;
  /**
   * Exact per-video price (USD) when resolved from pricing units
   */
  pricePerVideo?: number;
  pricing?: Pricing;
  releasedAt?: string;
}

export interface EnabledAiModel {
  abilities: ModelAbilities;
  config?: AiModelConfig;
  contextWindowTokens?: number;
  displayName?: string;
  enabled?: boolean;
  family?: string;
  generation?: string;
  id: string;
  knowledgeCutoff?: string;
  maxOutput?: number;
  parameters?: ModelParamsSchema;
  pricing?: Pricing;
  providerId: string;
  releasedAt?: string;
  settings?: AiModelSettings;
  sort?: number;
  type: AiModelType;
  visible?: boolean;
}
