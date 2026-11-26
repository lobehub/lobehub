import { A2uiApiName, A2uiIdentifier } from '@lobechat/builtin-tool-a2ui';
import type { ChannelMessageSurface } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

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
  return states
    .map((state) => (isRecord(state) ? state.surface : undefined))
    .filter(
      (surface): surface is ChannelMessageSurface =>
        isRecord(surface) &&
        typeof surface.surfaceId === 'string' &&
        Array.isArray(surface.operations),
    );
};
