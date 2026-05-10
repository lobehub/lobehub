export const INTEREST_AREA_KEYS = [
  'writing',
  'coding',
  'design',
  'education',
  'business',
  'marketing',
  'product',
  'sales',
  'operations',
  'hr',
  'finance-legal',
  'creator',
  'investing',
  'parenting',
  'health',
  'hobbies',
  'personal',
] as const;

export type InterestAreaKey = (typeof INTEREST_AREA_KEYS)[number];

const interestAreaKeySet = new Set<string>(INTEREST_AREA_KEYS);

export const isInterestAreaKey = (value: string): value is InterestAreaKey =>
  interestAreaKeySet.has(value);

export const resolveInterestAreaKey = (value: string): InterestAreaKey | undefined => {
  const normalized = value.trim();

  return isInterestAreaKey(normalized) ? normalized : undefined;
};

export const normalizeInterestsForStorage = (interests: readonly string[]): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const interest of interests) {
    const trimmed = interest.trim();
    if (!trimmed) continue;

    const areaKey = resolveInterestAreaKey(trimmed);
    const normalized = areaKey ?? trimmed;
    const dedupeKey = areaKey ? `area:${areaKey}` : `raw:${trimmed}`;

    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    result.push(normalized);
  }

  return result;
};
