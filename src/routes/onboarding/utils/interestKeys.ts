import type { InterestAreaKey } from '../config';
import { INTEREST_AREAS } from '../config';

export interface InterestAreaTranslator {
  (key: `interests.area.${InterestAreaKey}`): string;
}

const normalizeInterestLookupValue = (value: string) =>
  value.normalize('NFKC').trim().toLocaleLowerCase();

export const isInterestAreaKey = (value: string): value is InterestAreaKey =>
  INTEREST_AREAS.some((area) => area.key === value);

export const resolveInterestAreaKey = (
  value: string,
  translateArea: InterestAreaTranslator,
): InterestAreaKey | undefined => {
  const normalized = normalizeInterestLookupValue(value);

  for (const area of INTEREST_AREAS) {
    if (normalizeInterestLookupValue(area.key) === normalized) return area.key;
    if (normalizeInterestLookupValue(`interests.area.${area.key}`) === normalized) return area.key;

    const label = translateArea(`interests.area.${area.key}`);
    if (label && normalizeInterestLookupValue(label) === normalized) return area.key;
  }
};

export const normalizeInterestsForStorage = (
  interests: string[],
  translateArea: InterestAreaTranslator,
): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const interest of interests) {
    const areaKey = resolveInterestAreaKey(interest, translateArea);
    const normalized = areaKey ?? interest;
    const dedupeKey = areaKey ? `area:${areaKey}` : `raw:${interest}`;

    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    result.push(normalized);
  }

  return result;
};
