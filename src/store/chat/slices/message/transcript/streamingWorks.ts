import type { UIChatMessage } from '@lobechat/types';

const worksKey = (message: UIChatMessage) =>
  `${message.metadata?.work?.rootOperationId ?? ''}|${(message.works ?? [])
    .map((work) => `${work.id}:${work.version?.id ?? ''}`)
    .join(',')}`;

/**
 * Work summaries are server-derived: a scan stamps `metadata.work` on an anchor
 * row and the read attaches `works`. The stream never writes either, so a fetch
 * that lands while a run streams can carry them onto the streamed rows — that
 * is how a CLI agent's artboard card shows up while the agent is still writing
 * its boards — without touching any streamed content.
 */
export const applyStreamingWorks = (local: UIChatMessage[], incoming: UIChatMessage[]) => {
  const incomingById = new Map(incoming.map((message) => [message.id, message]));
  let changed = false;
  const merged = local.map((message) => {
    const fetched = incomingById.get(message.id);
    const work = fetched?.metadata?.work;
    if (!fetched?.works?.length || !work || worksKey(fetched) === worksKey(message)) return message;
    changed = true;
    return { ...message, metadata: { ...message.metadata, work }, works: fetched.works };
  });
  return changed ? merged : local;
};
