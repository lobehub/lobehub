import type { TriggerFilter } from './types';

/**
 * Query parameter that opens the Topics page with one source picked, e.g.
 * `/agent/:aid/topics?trigger=share` from the sidebar's Visitors section. The page applies it
 * once and drops it from the URL, so later filter changes are not overridden by a stale link.
 */
export const TOPICS_TRIGGER_PARAM = 'trigger';

const TRIGGERS = new Set<TriggerFilter>([
  'api',
  'bot',
  'channel',
  'chat',
  'eval',
  'share',
  'task',
  'webhook',
]);

export const parseTriggerParam = (value: string | null): TriggerFilter | undefined =>
  value && TRIGGERS.has(value as TriggerFilter) ? (value as TriggerFilter) : undefined;
