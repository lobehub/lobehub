// es-toolkit/compat `merge` skips `__proto__` and writes `constructor` as an own
// property, so an index record cannot reach Object.prototype through it.
import { cloneDeep, merge } from 'es-toolkit/compat';

import { DEFAULT_PLUGIN_ITEM } from './const';
import type { PluginStore } from './store';

export const getPluginDetail = async (store: PluginStore, identifier: string) => {
  const all = await store.listPlugins();
  const raw = all.find((item) => item.identifier === identifier);
  if (raw) return { ...merge(cloneDeep(DEFAULT_PLUGIN_ITEM), raw), source: 'legacy' };

  const detail = await store.getMarketDetail(identifier);
  const converted = {
    author: typeof detail.author === 'object' ? detail.author?.name || '' : detail.author || '',
    category: detail.category,
    description: detail.description || '',
    identifier: detail.identifier,
    tags: detail.tags || [],
    title: detail.name || detail.identifier,
  };

  return { ...merge(cloneDeep(DEFAULT_PLUGIN_ITEM), converted), source: 'market' };
};
