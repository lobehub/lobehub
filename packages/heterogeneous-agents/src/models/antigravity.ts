import { stripVTControlCharacters } from 'node:util';

import type { HeterogeneousAgentModel } from '@lobechat/types';

/** Parse the slug and display-name columns emitted by `agy models`. */
export const parseAntigravityModelCatalog = (stdout: string): HeterogeneousAgentModel[] => {
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];

  for (const line of stripVTControlCharacters(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    const separator = trimmed.search(/\s{2}|\t/);
    if (separator < 0) continue;
    const id = trimmed.slice(0, separator);
    const label = trimmed.slice(separator).trim();
    if (!/^\w[\w./:@+-]*$/.test(id) || id.endsWith(':') || !label) continue;
    if (['model', 'models', 'slug', 'id'].includes(id.toLowerCase()) || seen.has(id)) continue;

    seen.add(id);
    models.push({ id, label: label.trim(), modelId: id, providerId: 'antigravity' });
  }

  return models;
};
