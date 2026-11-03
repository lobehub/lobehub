import { describe, expect, it } from 'vitest';

import { processCommands } from './index';

const baseParams = {
  message: 'hello',
  context: {
    agentId: 'agent-1',
    topicId: 'topic-1',
  },
} as any;

describe('processCommands', () => {
  it('should return empty overrides when no editorData', () => {
    expect(processCommands(baseParams)).toEqual({});
  });

  it('should return empty overrides when no command tags', () => {
    const params = {
      ...baseParams,
      editorData: {
        root: {
          children: [
            {
              children: [
                {
                  actionCategory: 'skill',
                  actionLabel: 'Translate',
                  actionType: 'translate',
                  type: 'action-tag',
                },
              ],
              type: 'paragraph',
            },
          ],
          type: 'root',
        },
      },
    };
    expect(processCommands(params)).toEqual({});
  });

  it('should return forceNewTopic for newTopic command', () => {
    const params = {
      ...baseParams,
      editorData: {
        root: {
          children: [
            {
              children: [
                {
                  actionCategory: 'command',
                  actionLabel: 'Send in new topic',
                  actionType: 'newTopic',
                  type: 'action-tag',
                },
              ],
              type: 'paragraph',
            },
          ],
          type: 'root',
        },
      },
    };

    const result = processCommands(params);
    expect(result.forceNewTopic).toBe(true);
  });

  it('should return triggerCompression for compact command', () => {
    const params = {
      ...baseParams,
      editorData: {
        root: {
          children: [
            {
              children: [
                {
                  actionCategory: 'command',
                  actionLabel: 'Compact context',
                  actionType: 'compact',
                  type: 'action-tag',
                },
              ],
              type: 'paragraph',
            },
          ],
          type: 'root',
        },
      },
    };

    const result = processCommands(params);
    expect(result.triggerCompression).toBe(true);
  });

  it('should merge overrides from multiple commands', () => {
    const params = {
      ...baseParams,
      editorData: {
        root: {
          children: [
            {
              children: [
                {
                  actionCategory: 'command',
                  actionLabel: 'Send in new topic',
                  actionType: 'newTopic',
                  type: 'action-tag',
                },
                {
                  actionCategory: 'command',
                  actionLabel: 'Compact context',
                  actionType: 'compact',
                  type: 'action-tag',
                },
              ],
              type: 'paragraph',
            },
          ],
          type: 'root',
        },
      },
    };

    const result = processCommands(params);
    expect(result.forceNewTopic).toBe(true);
    expect(result.triggerCompression).toBe(true);
  });
});
