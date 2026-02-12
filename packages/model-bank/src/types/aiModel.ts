import { z } from 'zod';

import type { ModelParamsSchema } from '../standard-parameters';

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
  'stt',
  'image',
  'text2video',
  'text2music',
  'realtime',
] as const);

export type AiModelType = z.infer<typeof AiModelTypeSchema>;

export interface ModelAbilities {
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
  | 'imageOutput';

export type PricingUnitType =
  | 'millionTokens' // per 1M tokens
  | 'millionCharacters' // per 1M characters
  | 'image' // per image
  | 'megapixel' // per megapixel
  | 'second'; // per second

export type PricingStrategy = 'fixed' | 'tiered' | 'lookup';

export interface PricingUnitBase {
  name: PricingUnitName;
  strategy: PricingStrategy;
  unit: PricingUnitType;
}

export interface FixedPricingUnit extends PricingUnitBase {
  rate: number;
  strategy: 'fixed';
}

export interface TieredPricingUnit extends PricingUnitBase {
  strategy: 'tiered';
  tiers: Array<{
    rate: number;
    upTo: number | 'infinity';
  }>;
}

export interface LookupPricingUnit extends PricingUnitBase {
  lookup: {
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
  currency?: ModelPriceCurrency;
  units: PricingUnit[];
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
  id: string;
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
}

export interface AiModelConfig {
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
  | 'enableReasoning'
  | 'enableAdaptiveThinking'
  | 'disableContextCaching'
  | 'effort'
  | 'reasoningEffort'
  | 'gpt5ReasoningEffort'
  | 'gpt5_1ReasoningEffort'
  | 'gpt5_2ReasoningEffort'
  | 'gpt5_2ProReasoningEffort'
  | 'textVerbosity'
  | 'thinking'
  | 'thinkingBudget'
  | 'thinkingLevel'
  | 'thinkingLevel2'
  | 'imageAspectRatio'
  | 'imageResolution'
  | 'urlContext';

export interface AiModelSettings {
  extendParams?: ExtendParamsType[];
  /**
   * How the model layer implements search
   */
  searchImpl?: ModelSearchImplementType;
  searchProvider?: string;
}

export const ExtendParamsTypeSchema = z.enum([
  'reasoningBudgetToken',
  'enableReasoning',
  'enableAdaptiveThinking',
  'disableContextCaching',
  'effort',
  'reasoningEffort',
  'gpt5ReasoningEffort',
  'gpt5_1ReasoningEffort',
  'gpt5_2ReasoningEffort',
  'gpt5_2ProReasoningEffort',
  'textVerbosity',
  'thinking',
  'thinkingBudget',
  'thinkingLevel',
  'thinkingLevel2',
  'imageAspectRatio',
  'imageResolution',
  'urlContext',
]);

export const ModelSearchImplementTypeSchema = z.enum(['tool', 'params', 'internal']);

export const AiModelSettingsSchema = z.object({
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

export interface AITTSModelCard extends AIBaseModelCard {
  pricing?: Pricing;
  type: 'tts';
}

export interface AISTTModelCard extends AIBaseModelCard {
  pricing?: Pricing;
  type: 'stt';
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
  displayName?: string;
  enabled: boolean;
  id: string;
  parameters?: ModelParamsSchema;
  pricing?: Pricing;
  releasedAt?: string;
  settings?: AiModelSettings;
  source?: AiModelSourceType;
  type: AiModelType;
}

// Update
export const UpdateAiModelSchema = z.object({
  abilities: AiModelAbilitiesSchema.optional(),
  config: z
    .object({
      deploymentName: z.string().optional(),
    })
    .optional(),
  contextWindowTokens: z.number().nullable().optional(),
  displayName: z.string().nullable().optional(),
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
  contextWindowTokens?: number;
  description?: string;
  displayName?: string;
  id: string;
  parameters?: ModelParamsSchema;
  /**
   * Exact per-image price (USD) calculated from pricing units
   */
  pricePerImage?: number;
  pricing?: Pricing;
  releasedAt?: string;
}

export interface EnabledAiModel {
  abilities: ModelAbilities;
  config?: AiModelConfig;
  contextWindowTokens?: number;
  displayName?: string;
  enabled?: boolean;
  id: string;
  parameters?: ModelParamsSchema;
  providerId: string;
  releasedAt?: string;
  settings?: AiModelSettings;
  sort?: number;
  type: AiModelType;
}
