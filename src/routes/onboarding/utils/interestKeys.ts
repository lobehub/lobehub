import type { InterestAreaKey } from '@lobechat/const';
import { isInterestAreaKey } from '@lobechat/const';

export { isInterestAreaKey } from '@lobechat/const';

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
