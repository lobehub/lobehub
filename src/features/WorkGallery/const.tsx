import type { WorkSkillProvider, WorkType } from '@lobechat/types';

/**
 * `?works=` values: the per-type keys (task / document) plus the per-PROVIDER
 * keys (linear / github) and a combined `all` view. The sidebar currently
 * exposes only the single `all` entry — the narrower keys stay parseable so
 * deep links keep working and per-category tabs can return without a URL
 * migration.
 */
export type WorkGalleryKey = 'all' | 'document' | 'github' | 'linear' | 'task';

/**
 * How a gallery key narrows the workspace Work list: `type` selects a Work type
 * (task / document); `provider` narrows the `external` type to one skill
 * provider (linear / github); `all` carries neither (combined view).
 */
export interface WorkGalleryFilter {
  provider?: WorkSkillProvider;
  type?: WorkType;
}

const FILTER_BY_KEY = new Map<WorkGalleryKey, WorkGalleryFilter>([
  ['all', {}],
  ['task', { type: 'task' }],
  ['document', { type: 'document' }],
  ['linear', { provider: 'linear' }],
  ['github', { provider: 'github' }],
]);

/** Parse the raw `?works=` param into a valid key, or null when absent/invalid. */
export const parseWorkGalleryKey = (value: string | null): WorkGalleryKey | null =>
  value && FILTER_BY_KEY.has(value as WorkGalleryKey) ? (value as WorkGalleryKey) : null;

/** The type/provider filter a key maps to (`all` → `{}`, no filter). */
export const workFilterFromKey = (key: WorkGalleryKey): WorkGalleryFilter =>
  FILTER_BY_KEY.get(key) ?? {};
