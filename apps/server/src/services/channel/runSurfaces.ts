import { A2uiApiName, A2uiIdentifier } from '@lobechat/builtin-tool-a2ui';
import { ChannelApiName, ChannelIdentifier } from '@lobechat/builtin-tool-channel';
import type { ChannelMessageSurface } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { toSurfaceRecords } from '@lobehub/a2ui/records';

import type { MessageModel } from '@/database/models/message';

/**
 * The cards one run drew (`lobe-a2ui.renderUI`), in the order it drew them; malformed states are
 * skipped. Read from the run's Topic, so a post retried after a crash keeps them.
 */
export const runSurfaces = async (
  messages: MessageModel,
  operationId: string,
  topicId: string,
): Promise<ChannelMessageSurface[]> => {
  const states = await messages.listToolStatesByOperationId({
    apiName: A2uiApiName.renderUI,
    identifier: A2uiIdentifier,
    operationId,
    topicId,
  });
  return toSurfaceRecords(states.map((state) => (isRecord(state) ? state.surface : undefined)));
};

/**
 * The cards (by `surfaceId`) this run already posted elsewhere with `lobe-channel.postMessage`,
 * read from those calls' results in its Topic. Only a post that landed leaves a result naming them.
 */
export const postedSurfaceIds = async (
  messages: MessageModel,
  operationId: string,
  topicId: string,
): Promise<Set<string>> => {
  const states = await messages.listToolStatesByOperationId({
    apiName: ChannelApiName.postMessage,
    identifier: ChannelIdentifier,
    operationId,
    topicId,
  });
  return new Set(
    states.flatMap((state) =>
      isRecord(state) && Array.isArray(state.surfaceIds)
        ? state.surfaceIds.filter((id): id is string => typeof id === 'string')
        : [],
    ),
  );
};

/**
 * The cards a run's own answer carries: every card it drew except those a `postMessage` of this
 * run already posted elsewhere. A card is one `surfaceId`: drawn again after it was posted, it
 * stays posted, and goes out again only when a `postMessage` names it.
 */
export const unpostedRunSurfaces = async (
  messages: MessageModel,
  operationId: string,
  topicId: string,
): Promise<ChannelMessageSurface[]> => {
  const [surfaces, posted] = await Promise.all([
    runSurfaces(messages, operationId, topicId),
    postedSurfaceIds(messages, operationId, topicId),
  ]);
  return posted.size ? surfaces.filter((surface) => !posted.has(surface.surfaceId)) : surfaces;
};
