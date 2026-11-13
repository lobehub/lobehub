import { isRecord, toRecord } from '@lobechat/utils/object';

import { MCP_EVENTS_EXTENSION_ID } from './schema';

/** Older draft servers used a top-level `events` capability. Only modern sessions qualify. */
export const getEventsCapability = (capabilities: unknown, era: string | undefined) => {
  if (era !== 'modern') return { supported: false };
  const value = toRecord(capabilities) ?? {};
  const extension = (toRecord(value.extensions) ?? {})[MCP_EVENTS_EXTENSION_ID];
  const events = isRecord(extension) ? extension : value.events;
  return {
    supported: isRecord(events),
    ...(isRecord(events) && { listChanged: events.listChanged === true }),
  };
};
