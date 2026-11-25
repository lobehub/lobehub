import type { ContextReplaySnapshot, UIChatMessage } from '@lobechat/types';
import { expect, it } from 'vitest';

import { runContextEngineering } from './index';
import type { ContextSnapshot } from './types';

it('carries invocation snapshots through the shared host assembly and replays its baseline', async () => {
  const input: ContextSnapshot = {
    agent: { systemRole: 'Original role' },
    model: { model: 'gpt-4', provider: 'openai' },
    run: {
      contextReplay: { invocationId: 'a1' },
      messages: [{ id: 'u1', role: 'user', content: 'hello' } as UIChatMessage],
    },
  };
  const first = await runContextEngineering(input);
  const snapshot = first.metadata.contextReplaySnapshot as ContextReplaySnapshot;
  expect(snapshot).toMatchObject({ invocationId: 'a1' });
  const retry = await runContextEngineering({
    ...input,
    agent: { systemRole: 'Changed role' },
    run: { ...input.run, contextReplay: { invocationId: 'a1', committedSnapshot: snapshot } },
  });
  expect(retry.messages).toEqual(first.messages);
});
