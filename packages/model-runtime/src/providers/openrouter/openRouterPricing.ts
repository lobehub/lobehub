import type { LookupPricingUnit, Pricing, PricingUnit } from 'model-bank';

import type {
  OpenRouterImageEndpoint,
  OpenRouterImagePricingLine,
  OpenRouterVideoModelCard,
} from './type';

export const formatPrice = (price?: string) => {
  if (price === undefined || price === '-1') return undefined;
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) return undefined;
  return Number((numericPrice * 1e6).toPrecision(5));
};

export const parsePrice = (price?: string) => {
  if (price === undefined || price === '-1') return undefined;
  const numericPrice = Number(price);
  return Number.isFinite(numericPrice) && numericPrice >= 0 ? numericPrice : undefined;
};

export const fixedUnit = (
  name: PricingUnit['name'],
  rate: number | undefined,
  unit: PricingUnit['unit'],
): PricingUnit | undefined =>
  typeof rate === 'number' ? { name, rate, strategy: 'fixed', unit } : undefined;

export const compactUnits = (units: Array<PricingUnit | undefined>): PricingUnit[] =>
  units.filter((unit): unit is PricingUnit => !!unit);

export const mergePricing = (base?: Pricing, generation?: Pricing): Pricing | undefined => {
  if (!base) return generation;
  if (!generation) return base;

  const generationUnitNames = new Set(generation.units.map((unit) => unit.name));
  return {
    approximatePricePerImage: generation.approximatePricePerImage ?? base.approximatePricePerImage,
    approximatePricePerVideo: generation.approximatePricePerVideo ?? base.approximatePricePerVideo,
    currency: generation.currency ?? base.currency,
    units: [
      ...base.units.filter((unit) => !generationUnitNames.has(unit.name)),
      ...generation.units,
    ],
  };
};

const IMAGE_PRICING_UNIT_NAMES = new Set(['imageGeneration', 'imageInput', 'imageOutput']);

/** Drop generic /models image units so dedicated endpoint pricing is the only image bill. */
export const withoutImagePricingUnits = (pricing?: Pricing): Pricing | undefined => {
  if (!pricing) return undefined;
  const units = pricing.units.filter((unit) => !IMAGE_PRICING_UNIT_NAMES.has(unit.name));
  if (units.length === 0 && pricing.approximatePricePerImage === undefined) {
    return pricing.approximatePricePerVideo === undefined && !pricing.currency
      ? undefined
      : { ...pricing, units };
  }
  return { ...pricing, units };
};

const tokenRateFromUsd = (costUsd: number) => Number((costUsd * 1e6).toPrecision(5));

const normalizeResolutionLabel = (value: string) => {
  const normalized = value.replaceAll('-', '_');
  const compact = normalized.toLowerCase();
  if (compact === '1k') return '1K';
  if (compact === '2k') return '2K';
  if (compact === '4k' || compact === '2160p') return '4K';
  if (compact === '1024p') return '1080p';
  return value;
};

const parseImageVariant = (variant?: string): { quality?: string; resolution?: string } => {
  if (!variant) return {};
  const normalized = variant.toLowerCase().replaceAll('-', '_');
  if (normalized === 'high_resolution') return { resolution: '2K' };

  let quality: string | undefined;
  let resolution: string | undefined;
  for (const part of normalized.split('_')) {
    if (part === '1k') resolution = '1K';
    else if (part === '2k') resolution = '2K';
    else if (part === '4k') resolution = '4K';
    else if (/^\d{3,4}p$/.test(part)) resolution = part;
    else if (['low', 'medium', 'high', 'auto', 'standard', 'hd'].includes(part)) quality = part;
  }
  return { quality, resolution };
};

const resolutionEnumsFromEndpoints = (endpoints: OpenRouterImageEndpoint[]): string[] => {
  for (const endpoint of endpoints) {
    const values = endpoint.supported_parameters?.resolution?.values;
    if (values?.length) return values.map(normalizeResolutionLabel);
  }
  return [];
};

const toLookupUnit = (
  name: PricingUnit['name'],
  unit: PricingUnit['unit'],
  pricingParams: string[],
  prices: Record<string, number>,
): LookupPricingUnit | undefined => {
  const keys = Object.keys(prices);
  if (keys.length === 0) return undefined;
  if (keys.length === 1) {
    return undefined;
  }
  return {
    lookup: { prices, pricingParams },
    name,
    strategy: 'lookup',
    unit,
  };
};

const outputImageLines = (lines: OpenRouterImagePricingLine[]) =>
  lines.filter((line) => line.billable === 'output_image' && Number.isFinite(line.cost_usd));

const inputImageLines = (lines: OpenRouterImagePricingLine[]) =>
  lines.filter((line) => line.billable === 'input_image' && Number.isFinite(line.cost_usd));

const pickFirstEndpointWithPricing = (endpoints: OpenRouterImageEndpoint[]) =>
  endpoints.find((endpoint) => (endpoint.pricing ?? []).length > 0);

export const resolveOpenRouterImageEndpointPricing = (
  endpoints: OpenRouterImageEndpoint[],
): Pricing | undefined => {
  const endpoint = pickFirstEndpointWithPricing(endpoints);
  const lines = endpoint?.pricing ?? [];
  if (lines.length === 0) return undefined;

  const units: PricingUnit[] = [];
  const supportedResolutions = resolutionEnumsFromEndpoints(endpoints);
  const outputs = outputImageLines(lines);
  const inputs = inputImageLines(lines);

  const tokenOutputs = outputs.filter((line) => line.unit === 'token');
  const imageOutputs = outputs.filter((line) => line.unit === 'image');
  const megapixelOutputs = outputs.filter((line) => line.unit === 'megapixel');

  if (tokenOutputs.length > 0) {
    const unvarianted = tokenOutputs.find((line) => !line.variant) ?? tokenOutputs[0];
    units.push({
      name: 'imageOutput',
      rate: tokenRateFromUsd(unvarianted.cost_usd),
      strategy: 'fixed',
      unit: 'millionTokens',
    });
  }

  if (megapixelOutputs.length > 0) {
    units.push({
      name: 'imageGeneration',
      rate: megapixelOutputs[0].cost_usd,
      strategy: 'fixed',
      unit: 'megapixel',
    });
  } else if (imageOutputs.length > 0) {
    const parsed = imageOutputs.map((line) => ({
      ...parseImageVariant(line.variant),
      cost: line.cost_usd,
    }));
    const hasQuality = parsed.some((line) => !!line.quality);
    const hasResolution = parsed.some((line) => !!line.resolution) || parsed.length > 1;
    const usedResolutions = new Set(
      parsed.map((line) => line.resolution).filter((value): value is string => !!value),
    );

    const prices: Record<string, number> = {};
    for (const line of parsed) {
      let resolution = line.resolution;
      if (!resolution && hasResolution) {
        resolution =
          supportedResolutions.find((value) => !usedResolutions.has(value)) ??
          (usedResolutions.has('1K') ? undefined : '1K');
        if (resolution) usedResolutions.add(resolution);
      }

      const key = [
        ...(hasQuality && line.quality ? [line.quality] : []),
        ...(hasResolution && resolution ? [resolution] : []),
      ].join('_');
      if (key) prices[key] = line.cost;
    }

    const pricingParams = [
      ...(hasQuality ? ['quality'] : []),
      ...(hasResolution ? ['resolution'] : []),
    ];
    const lookup = toLookupUnit('imageGeneration', 'image', pricingParams, prices);
    if (lookup) {
      units.push(lookup);
    } else {
      units.push({
        name: 'imageGeneration',
        rate: Math.min(...imageOutputs.map((line) => line.cost_usd)),
        strategy: 'fixed',
        unit: 'image',
      });
    }
  }

  if (inputs.length > 0) {
    const input = inputs[0];
    if (input.unit === 'token') {
      units.push({
        name: 'imageInput',
        rate: tokenRateFromUsd(input.cost_usd),
        strategy: 'fixed',
        unit: 'millionTokens',
      });
    } else if (input.unit === 'megapixel') {
      units.push({
        name: 'imageInput',
        rate: input.cost_usd,
        strategy: 'fixed',
        unit: 'megapixel',
      });
    } else {
      units.push({
        name: 'imageInput',
        rate: input.cost_usd,
        strategy: 'fixed',
        unit: 'image',
      });
    }
  }

  if (units.length === 0) return undefined;

  const approximatePricePerImage =
    imageOutputs.length > 0 ? Math.min(...imageOutputs.map((line) => line.cost_usd)) : undefined;

  return {
    ...(typeof approximatePricePerImage === 'number' && { approximatePricePerImage }),
    currency: 'USD',
    units,
  };
};

/** Matches Create Video defaults in model-bank `DEFAULT_VIDEO_GENERATION_PARAMS`. */
export const DEFAULT_OPENROUTER_VIDEO_DURATION = 5;
export const DEFAULT_OPENROUTER_VIDEO_RESOLUTION = '720p';

export const getDefaultVideoDuration = (durations: number[] | null): number => {
  if (!durations?.length) return DEFAULT_OPENROUTER_VIDEO_DURATION;
  if (durations.includes(DEFAULT_OPENROUTER_VIDEO_DURATION)) {
    return DEFAULT_OPENROUTER_VIDEO_DURATION;
  }
  return [...durations].sort((a, b) => a - b)[0];
};

export const getDefaultVideoResolution = (resolutions: string[] | null): string | undefined => {
  if (!resolutions?.length) return DEFAULT_OPENROUTER_VIDEO_RESOLUTION;
  if (resolutions.includes(DEFAULT_OPENROUTER_VIDEO_RESOLUTION)) {
    return DEFAULT_OPENROUTER_VIDEO_RESOLUTION;
  }
  return resolutions[0];
};

const normalizeSkuKey = (key: string) => key.toLowerCase().replaceAll('-', '_');

const extractSkuResolution = (key: string): string | undefined => {
  const match = normalizeSkuKey(key).match(/(?:^|_)(\d{3,4}p|[124]k)(?:_|$)/);
  return match ? normalizeResolutionLabel(match[1]) : undefined;
};

const extractSkuAudio = (key: string): boolean | undefined => {
  const normalized = normalizeSkuKey(key);
  if (normalized.includes('with_audio')) return true;
  if (normalized.includes('without_audio')) return false;
  return undefined;
};

const isSkippedVideoSku = (key: string) => {
  const normalized = normalizeSkuKey(key);
  return (
    normalized.includes('minimum') ||
    normalized.includes('image_input') ||
    normalized.includes('reference') ||
    normalized.includes('continuation') ||
    normalized.includes('video_input') ||
    normalized.includes('image_to_video')
  );
};

const isVideoSecondSku = (key: string) => {
  const normalized = normalizeSkuKey(key);
  if (isSkippedVideoSku(key)) return false;
  return normalized.includes('duration_seconds') || normalized.includes('second');
};

const isVideoTokenSku = (key: string) => {
  const normalized = normalizeSkuKey(key);
  if (isSkippedVideoSku(key)) return false;
  return normalized.includes('video_tokens');
};

const priceFromVideoSecondSku = (key: string, value: string) => {
  const price = parsePrice(value);
  if (price === undefined) return undefined;
  return normalizeSkuKey(key).startsWith('cents_') ? price / 100 : price;
};

const scoreVideoSecondSku = (
  key: string,
  model: OpenRouterVideoModelCard,
  defaultResolution: string | undefined,
) => {
  const normalizedKey = normalizeSkuKey(key);
  let score = 0;

  if (
    normalizedKey === 'duration_seconds' ||
    normalizedKey === 'cents_per_second_output' ||
    normalizedKey === 'per_video_second'
  ) {
    score += 5;
  }

  if (model.generate_audio === true) {
    if (normalizedKey.includes('with_audio')) score += 20;
    if (normalizedKey.includes('without_audio')) score -= 20;
  } else if (model.generate_audio === false) {
    if (normalizedKey.includes('without_audio')) score += 20;
    if (normalizedKey.includes('with_audio')) score -= 20;
  }

  const resolutionMatches = normalizedKey.match(/(?:^|_)(\d{3,4}p|[124]k)(?:_|$)/g) ?? [];
  if (defaultResolution) {
    const normalizedResolution = defaultResolution.toLowerCase();
    if (normalizedKey.includes(normalizedResolution.toLowerCase())) score += 10;
    else if (resolutionMatches.length > 0) score -= 10;
  }

  if (normalizedKey.includes('text_to_video')) score += 3;
  return score;
};

interface VideoSkuRate {
  generateAudio?: boolean;
  rate: number;
  resolution?: string;
  score: number;
}

const comboKey = (resolution?: string, generateAudio?: boolean) =>
  `${resolution ?? ''}|${generateAudio === undefined ? '' : String(generateAudio)}`;

const pickBestRates = (candidates: VideoSkuRate[]): VideoSkuRate[] => {
  const best = new Map<string, VideoSkuRate>();
  for (const candidate of candidates) {
    const key = comboKey(candidate.resolution, candidate.generateAudio);
    const current = best.get(key);
    if (!current || candidate.score > current.score) best.set(key, candidate);
  }
  return [...best.values()];
};

const fillUnscopedResolutions = (
  rates: VideoSkuRate[],
  supportedResolutions: string[] | null,
): VideoSkuRate[] => {
  const resolutions = supportedResolutions?.length ? supportedResolutions : [];
  const scoped = rates.filter((rate) => rate.resolution);
  const unscoped = rates.filter((rate) => !rate.resolution);
  if (unscoped.length === 0 || resolutions.length === 0) return rates;

  const filled = [...scoped];
  for (const rate of unscoped) {
    const missing = resolutions.filter(
      (resolution) =>
        !scoped.some(
          (item) => item.resolution === resolution && item.generateAudio === rate.generateAudio,
        ),
    );
    if (missing.length === 0) {
      filled.push(rate);
      continue;
    }
    for (const resolution of missing) {
      filled.push({ ...rate, resolution });
    }
  }
  return filled;
};

const toVideoGenerationUnit = (
  rates: VideoSkuRate[],
  unit: PricingUnit['unit'],
): PricingUnit | undefined => {
  if (rates.length === 0) return undefined;
  const uniqueRates = [...new Set(rates.map((item) => item.rate))];
  const hasResolution = rates.some((item) => item.resolution);
  const hasAudio = rates.some((item) => item.generateAudio !== undefined);

  if (uniqueRates.length === 1 && !hasResolution && !hasAudio) {
    return { name: 'videoGeneration', rate: uniqueRates[0], strategy: 'fixed', unit };
  }

  if (!hasResolution && !hasAudio) {
    return { name: 'videoGeneration', rate: Math.min(...uniqueRates), strategy: 'fixed', unit };
  }

  const pricingParams = [
    ...(hasResolution ? ['resolution'] : []),
    ...(hasAudio ? ['generateAudio'] : []),
  ];
  const prices: Record<string, number> = {};
  for (const item of rates) {
    const parts = [
      ...(hasResolution && item.resolution ? [item.resolution] : []),
      ...(hasAudio && item.generateAudio !== undefined ? [String(item.generateAudio)] : []),
    ];
    if (parts.length === 0) continue;
    const key = parts.join('_');
    if (prices[key] === undefined) prices[key] = item.rate;
  }

  const lookup = toLookupUnit('videoGeneration', unit, pricingParams, prices);
  if (lookup) return lookup;

  return {
    name: 'videoGeneration',
    rate: Math.min(...uniqueRates),
    strategy: 'fixed',
    unit,
  };
};

const defaultSecondRate = (
  rates: VideoSkuRate[],
  model: OpenRouterVideoModelCard,
): number | undefined => {
  const defaultResolution = getDefaultVideoResolution(model.supported_resolutions);
  const wantAudio = model.generate_audio === true;
  const ranked = [...rates].sort((a, b) => {
    const aRes = a.resolution === defaultResolution ? 1 : 0;
    const bRes = b.resolution === defaultResolution ? 1 : 0;
    if (bRes !== aRes) return bRes - aRes;
    const aAudio = a.generateAudio === wantAudio ? 1 : a.generateAudio === undefined ? 0 : -1;
    const bAudio = b.generateAudio === wantAudio ? 1 : b.generateAudio === undefined ? 0 : -1;
    if (bAudio !== aAudio) return bAudio - aAudio;
    return a.rate - b.rate;
  });
  return ranked[0]?.rate;
};

/** Convert OpenRouter's heterogeneous video SKUs into Create Video pricing units. */
export const resolveOpenRouterVideoPricing = (
  model: OpenRouterVideoModelCard,
): Pricing | undefined => {
  const entries = Object.entries(model.pricing_skus ?? {});
  const defaultResolution = getDefaultVideoResolution(model.supported_resolutions);

  const secondCandidates: VideoSkuRate[] = entries
    .filter(([key]) => isVideoSecondSku(key))
    .map(([key, value]) => ({
      generateAudio: extractSkuAudio(key),
      rate: priceFromVideoSecondSku(key, value),
      resolution: extractSkuResolution(key),
      score: scoreVideoSecondSku(key, model, defaultResolution),
    }))
    .filter((entry): entry is VideoSkuRate => typeof entry.rate === 'number');

  const secondRates = fillUnscopedResolutions(
    pickBestRates(secondCandidates),
    model.supported_resolutions,
  );
  const secondUnit = toVideoGenerationUnit(secondRates, 'second');
  if (secondUnit) {
    const rate = defaultSecondRate(secondRates, model);
    return {
      ...(typeof rate === 'number' && {
        approximatePricePerVideo: rate * getDefaultVideoDuration(model.supported_durations),
      }),
      currency: 'USD',
      units: [secondUnit],
    };
  }

  const tokenCandidates: VideoSkuRate[] = entries
    .filter(([key]) => isVideoTokenSku(key))
    .map(([key, value]) => ({
      generateAudio: extractSkuAudio(key),
      rate: formatPrice(value),
      resolution: extractSkuResolution(key),
      score: key === 'video_tokens' ? 10 : 0,
    }))
    .filter((entry): entry is VideoSkuRate => typeof entry.rate === 'number');
  const tokenUnit = toVideoGenerationUnit(pickBestRates(tokenCandidates), 'millionTokens');
  if (tokenUnit) {
    return { currency: 'USD', units: [tokenUnit] };
  }

  const flatVideoEntry = entries.find(([key]) =>
    ['generate', 'per_video', 'per-video'].includes(key.toLowerCase()),
  );
  const flatVideoRate = parsePrice(flatVideoEntry?.[1]);
  if (typeof flatVideoRate === 'number') {
    return {
      approximatePricePerVideo: flatVideoRate,
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: flatVideoRate, strategy: 'fixed', unit: 'video' }],
    };
  }

  const minimumGenerationEntry = entries.find(([key]) =>
    key.toLowerCase().includes('minimum_cents_per_generation'),
  );
  const minimumGenerationPrice = parsePrice(minimumGenerationEntry?.[1]);
  if (typeof minimumGenerationPrice === 'number') {
    return {
      approximatePricePerVideo: minimumGenerationPrice / 100,
      currency: 'USD',
      units: [],
    };
  }

  return undefined;
};
