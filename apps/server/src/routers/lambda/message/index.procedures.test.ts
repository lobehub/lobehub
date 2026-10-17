// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { messageRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('messageRouter procedures', () => {
  const procedures = (messageRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['addFilesToMessage', 'mutation', 13],
    ['batchMutate', 'mutation', 14],
    ['cancelCompression', 'mutation', 13],
    ['count', 'query', 12],
    ['countByTopic', 'query', 12],
    ['countWords', 'query', 12],
    ['createCompressionGroup', 'mutation', 13],
    ['createMessage', 'mutation', 13],
    ['diagnoseTopic', 'query', 12],
    ['finalizeCompression', 'mutation', 13],
    ['getHeatmaps', 'query', 11],
    ['getMessages', 'query', 8],
    ['getMessagesByCursor', 'query', 8],
    ['getTokenHeatmaps', 'query', 11],
    ['getToolResultPayload', 'query', 12],
    ['getToolResultPayloads', 'query', 12],
    ['listAll', 'query', 12],
    ['rankModels', 'query', 11],
    ['removeMessage', 'mutation', 13],
    ['removeMessageQuery', 'mutation', 13],
    ['removeMessages', 'mutation', 13],
    ['removeMessagesByAssistant', 'mutation', 13],
    ['removeMessagesByGroup', 'mutation', 13],
    ['repairTopic', 'mutation', 13],
    ['searchMessages', 'query', 13],
    ['topicStats', 'query', 12],
    ['update', 'mutation', 13],
    ['updateMessageGroupMetadata', 'mutation', 13],
    ['updateMessagePlugin', 'mutation', 13],
    ['updateMessageRAG', 'mutation', 13],
    ['updateMetadata', 'mutation', 13],
    ['updatePluginError', 'mutation', 13],
    ['updatePluginState', 'mutation', 13],
    ['updateTTS', 'mutation', 13],
    ['updateToolArguments', 'mutation', 13],
    ['updateToolMessage', 'mutation', 13],
    ['updateTranslate', 'mutation', 13],
  ];
}
