import { compareSnapshots } from '../experiment/capture';
import type { ComponentSnapshot } from './capture';

export const compareComponents = (before: ComponentSnapshot, after: ComponentSnapshot) => {
  const raw = compareSnapshots(before.tree, after.tree);
  const beforeAttributes = new Map(before.attributes.map((entry) => [entry.key, entry]));
  const afterAttributes = new Map(after.attributes.map((entry) => [entry.key, entry]));
  for (const key of new Set([...beforeAttributes.keys(), ...afterAttributes.keys()])) {
    const previous = beforeAttributes.get(key);
    const current = afterAttributes.get(key);
    if (JSON.stringify(previous) !== JSON.stringify(current))
      raw.push({
        after: JSON.stringify(current),
        before: JSON.stringify(previous),
        key,
        property: 'DOM_ATTRIBUTES_OR_TEXT_CHANGED',
      });
  }
  return {
    diagnostics: raw.filter(
      (difference) => difference.diagnosticReason && !difference.property.startsWith('--'),
    ),
    differences: raw.filter((difference) => !difference.diagnosticReason),
    raw,
    review: raw.filter((difference) => difference.property.startsWith('--')),
  };
};
