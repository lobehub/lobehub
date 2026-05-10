import type { InterestAreaKey } from '../config';
import { INTEREST_AREAS } from '../config';

const interestAreaKeys = new Set<string>(INTEREST_AREAS.map((area) => area.key));

export const isInterestAreaKey = (value: string): value is InterestAreaKey =>
  interestAreaKeys.has(value);

export const resolveInterestAreaKey = (value: string): InterestAreaKey | undefined => {
  const normalized = value.trim();

  return isInterestAreaKey(normalized) ? normalized : undefined;
};

export const normalizeInterestsForStorage = (interests: string[]): string[] => {
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
