import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import { processMultiProviderModelList } from '../../utils/modelParse';

// Shape of one entry of `GET /v1/models` and `GET /anthropic/v1/models` (OpenRouter-style fields).
export interface DotHooshModelPricing {
  completion?: string;
  image?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  prompt?: string;
  request?: string;
}

export interface DotHooshPricingTier extends DotHooshModelPricing {
  above_input_tokens: number;
}

export interface DotHooshModelCard {
  architecture?: { input_modalities?: string[] };
  context_length?: number | null;
  created?: number;
  // The Anthropic-shaped listing uses an ISO timestamp and display_name.
  created_at?: string;
  display_name?: string;
  id: string;
  max_output_tokens?: number | null;
  name?: string;
  pricing?: DotHooshModelPricing;
  pricing_tiers?: DotHooshPricingTier[];
  protocols?: Array<{ protocol?: string }>;
  supported_parameters?: string[];
  top_provider?: { context_length?: number | null; max_completion_tokens?: number | null };
}

type PriceKey = 'completion' | 'input_cache_read' | 'input_cache_write' | 'prompt';

// DotHoosh price field -> LobeHub pricing unit name.
const PRICE_UNITS: Array<[PriceKey, string]> = [
  ['prompt', 'textInput'],
  ['completion', 'textOutput'],
  ['input_cache_read', 'textInput_cacheRead'],
  ['input_cache_write', 'textInput_cacheWrite'],
];

/** Per-token USD decimal string -> USD per million tokens (same conversion as OpenRouter). */
export const formatPrice = (price?: string) => {
  if (price === undefined || price === null || price === '') return undefined;
  const value = Number(price);
  if (Number.isNaN(value) || value < 0) return undefined;
  // Six decimals keep every digit of the gateway's per-token strings (0.000000385001 -> 0.385001).
  return Number((value * 1e6).toFixed(6));
};

const buildUnit = (
  name: string,
  key: PriceKey,
  pricing: DotHooshModelPricing,
  tiers: DotHooshPricingTier[],
) => {
  const base = formatPrice(pricing[key]);
  if (base === undefined) return undefined;

  // A tier only restates the prices that change, so walk the ascending thresholds and keep the
  // ones where this price actually moves.
  const steps: Array<{ above: number; rate: number }> = [];
  let current = base;
  for (const tier of tiers) {
    const rate = formatPrice(tier[key]);
    if (rate !== undefined && rate !== current) {
      steps.push({ above: tier.above_input_tokens, rate });
      current = rate;
    }
  }

  if (steps.length === 0) {
    return { name, rate: base, strategy: 'fixed' as const, unit: 'millionTokens' as const };
  }

  return {
    name,
    strategy: 'tiered' as const,
    tiers: [
      { rate: base, upTo: steps[0].above },
      ...steps.map((step, index) => ({
        rate: step.rate,
        upTo: steps[index + 1]?.above ?? ('infinity' as const),
      })),
    ],
    unit: 'millionTokens' as const,
  };
};

export const buildPricing = (model: DotHooshModelCard) => {
  if (!model.pricing) return undefined;
  const tiers = [...(model.pricing_tiers ?? [])].sort(
    (a, b) => a.above_input_tokens - b.above_input_tokens,
  );
  const units = PRICE_UNITS.flatMap(([key, name]) => {
    const unit = buildUnit(name, key, model.pricing!, tiers);
    return unit ? [unit] : [];
  });
  return units.length > 0 ? { units } : undefined;
};

const toUnixSeconds = (model: DotHooshModelCard) => {
  if (typeof model.created === 'number') return model.created;
  const parsed = model.created_at ? Date.parse(model.created_at) : Number.NaN;
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
};

// Reasoning enablement comes from the listing (`supported_parameters`). The listing carries no
// tuning-UI hint, so the settings below are a fallback: Claude (identified by the Anthropic
// listing, not by id) gets adaptive effort, and GPT-6 (the one id-based rule, a LobeHub UI
// control named after the family) gets its reasoning-effort control.
const buildSettings = (id: string, reasoning: boolean, fromAnthropic: boolean) => {
  if (!reasoning) return undefined;
  if (fromAnthropic) {
    return { disabledParams: ['temperature', 'top_p'], extendParams: ['opus47Effort'] };
  }
  if (id.toLowerCase().startsWith('gpt-6')) return { extendParams: ['gpt6ReasoningEffort'] };
  return undefined;
};

// First listed value that is a finite, positive number; null, missing or zero means "unknown".
const firstPositive = (...values: Array<number | null | undefined>) =>
  values.find(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );

export const toModelCard = (model: DotHooshModelCard, fromAnthropic = false) => {
  const parameters = model.supported_parameters ?? [];
  const reasoning = parameters.includes('reasoning');
  const settings = buildSettings(model.id, reasoning, fromAnthropic);
  const created = toUnixSeconds(model);

  return {
    contextWindowTokens: firstPositive(
      model.top_provider?.context_length,
      model.context_length,
    ),
    created,
    displayName: model.display_name || model.name || model.id,
    enabled: true,
    // Vendor ids resolve to the vendor's own card (vision, search, 1M context) that DotHoosh
    // does not necessarily offer, so every ability comes from the listing.
    files: false,
    functionCall: parameters.includes('tools'),
    id: model.id,
    maxOutput: firstPositive(
      model.top_provider?.max_completion_tokens,
      model.max_output_tokens,
    ),
    pricing: buildPricing(model),
    reasoning,
    search: false,
    ...(settings ? { settings } : {}),
    video: false,
    vision: model.architecture?.input_modalities?.includes('image') ?? false,
  };
};

export interface DotHooshCatalog {
  anthropic: DotHooshModelCard[];
  openai: DotHooshModelCard[];
}

/** Merge listings by id; the OpenAI listing wins, a Claude id is only in the Anthropic one. */
export const parseDotHooshModels = async ({ anthropic, openai }: DotHooshCatalog) => {
  const seen = new Set<string>();
  const cards = [
    ...openai.map((model) => [model, false] as const),
    ...anthropic.map((model) => [model, true] as const),
  ].flatMap(([model, fromAnthropic]) => {
    if (!model?.id || seen.has(model.id)) return [];
    seen.add(model.id);
    return [toModelCard(model, fromAnthropic)];
  });
  const own = new Map(
    cards.map((card) => [
      card.id,
      {
        contextWindowTokens: card.contextWindowTokens,
        maxOutput: card.maxOutput,
        settings: 'settings' in card ? card.settings : undefined,
      },
    ]),
  );

  const processed = await processMultiProviderModelList(cards as any, ModelProvider.DotHoosh);
  // The generic parser merges the settings and limits of the vendor card an id resolves to (verbosity,
  // thinking levels, URL context, a static output cap, ...), which DotHoosh does not offer. Only the
  // settings and limits set above survive. Limits come only from the listing too, so an unknown limit
  // stays unknown.
  return processed.map(({ settings: _vendorSettings, ...card }): ChatModelCard => {
    const { contextWindowTokens, maxOutput, settings } = own.get(card.id) ?? {
      contextWindowTokens: undefined,
      maxOutput: undefined,
      settings: undefined,
    };
    return {
      ...card,
      contextWindowTokens,
      maxOutput,
      ...(settings ? { settings: settings as ChatModelCard['settings'] } : {}),
    };
  });
};

export interface DotHooshRouteTable {
  /** ids served only on /anthropic/v1/models */
  anthropic: string[];
  /** ids whose protocols[] offer the Responses API (preferred over Chat Completions) */
  responses: string[];
}

const protocolsOf = (model: DotHooshModelCard) =>
  (model.protocols ?? []).map((item) => item.protocol);

export const buildRouteTable = ({ anthropic, openai }: DotHooshCatalog): DotHooshRouteTable => {
  // A model that the OpenAI listing also serves (DeepSeek is on both) goes to Chat Completions,
  // never to the Anthropic route, unless its protocols say it is Anthropic-only there.
  const onOpenAIRoute = new Set(
    openai
      .filter((model) => {
        const protocols = protocolsOf(model);
        return (
          protocols.length === 0 ||
          protocols.includes('openai-chat-completions') ||
          protocols.includes('openai-responses')
        );
      })
      .map((model) => model.id),
  );

  return {
    anthropic: anthropic.map((model) => model.id).filter((id) => id && !onOpenAIRoute.has(id)),
    responses: openai
      .filter((model) => protocolsOf(model).includes('openai-responses'))
      .map((model) => model.id),
  };
};
