import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { LocalSystemToolSnapshotInjector } from '../LocalSystemToolSnapshotInjector';

const createContext = (messages: any[] = []): PipelineContext => ({
  initialState: {
    messages: [],
    model: 'test-model',
    provider: 'test-provider',
  },
  isAborted: false,
  messages,
  metadata: {
    maxTokens: 4000,
    model: 'test-model',
  },
});

describe('LocalSystemToolSnapshotInjector', () => {
  it('should replay persisted readLocalFile snapshots as real tool call/result pairs', async () => {
    const injector = new LocalSystemToolSnapshotInjector({ enabled: true });
    const context = createContext([
      {
        content: 'Read this file',
        createdAt: 1,
        id: 'user-1',
        metadata: {
          localSystemToolSnapshots: [
            {
              apiName: 'readLocalFile',
              arguments: { path: '/tmp/a.ts' },
              capturedAt: '2026-04-28T00:00:00.000Z',
              content: '<file path="/tmp/a.ts">hello</file>',
              identifier: 'lobe-local-system',
              snapshotId: 'snapshot-1',
              state: { content: 'hello', path: '/tmp/a.ts' },
              success: true,
              toolCallId: 'call_snapshot_1',
            },
          ],
        },
        role: 'user',
        updatedAt: 1,
      },
      { content: 'Answer', id: 'assistant-1', role: 'assistant' },
    ]);

    const result = await injector.process(context);

    expect(result.messages).toHaveLength(4);
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      tools: [
        {
          apiName: 'readLocalFile',
          arguments: '{"path":"/tmp/a.ts"}',
          id: 'call_snapshot_1',
          identifier: 'lobe-local-system',
          type: 'builtin',
        },
      ],
    });
    expect(result.messages[2]).toMatchObject({
      content: '<file path="/tmp/a.ts">hello</file>',
      plugin: {
        apiName: 'readLocalFile',
        identifier: 'lobe-local-system',
        type: 'builtin',
      },
      pluginState: { content: 'hello', path: '/tmp/a.ts' },
      role: 'tool',
      tool_call_id: 'call_snapshot_1',
    });
    expect(result.metadata.LocalSystemToolSnapshotInjectorInjectedCount).toBe(1);
  });
});
