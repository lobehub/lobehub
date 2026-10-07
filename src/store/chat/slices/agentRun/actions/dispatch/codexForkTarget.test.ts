import { describe, expect, it } from 'vitest';

import { resolveCodexForkTarget } from './codexForkTarget';

describe('resolveCodexForkTarget', () => {
  const selected = {
    id: 'message-selected',
    metadata: { codexTurnId: 'native-turn-7', heteroSessionId: 'native-child-thread' },
  };

  it('uses native provenance even when earlier UI messages are not loaded', () => {
    expect(resolveCodexForkTarget([selected], selected.id, 'after')).toEqual({
      position: 'after',
      threadId: 'native-child-thread',
      turnId: 'native-turn-7',
    });
  });

  it('uses the same native turn as an exclusive boundary for an edit', () => {
    expect(resolveCodexForkTarget([selected], selected.id, 'before')).toEqual({
      position: 'before',
      threadId: 'native-child-thread',
      turnId: 'native-turn-7',
    });
  });

  it('rejects a missing source instead of resuming the original topic', () => {
    expect(() => resolveCodexForkTarget([selected], 'missing', 'after')).toThrow(
      'The selected Codex message is unavailable',
    );
  });

  it('rejects legacy rows without a reliable native turn boundary', () => {
    expect(() =>
      resolveCodexForkTarget(
        [{ id: 'legacy', metadata: { heteroSessionId: 'source' } }],
        'legacy',
        'after',
      ),
    ).toThrow('The selected message has no native Codex turn');
  });

  it('rejects turn metadata without a native thread', () => {
    expect(() =>
      resolveCodexForkTarget(
        [{ id: 'orphan', metadata: { codexTurnId: 'turn-1' } }],
        'orphan',
        'after',
      ),
    ).toThrow('The selected message has no native Codex thread');
  });
});
