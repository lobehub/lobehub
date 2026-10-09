import { describe, expect, it } from 'vitest';

import { resolveCodexBranchRun, resolveCodexForkTarget } from './codexForkTarget';

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

describe('resolveCodexBranchRun', () => {
  const origin = { position: 'after' as const, threadId: 'native-source', turnId: 'source-turn' };
  const thread = { id: 'branch', metadata: { codexForkTarget: origin } };
  const source = {
    id: 'source-answer',
    role: 'assistant',
    content: 'source answer',
    threadId: null,
    metadata: { codexTurnId: 'source-turn', heteroSessionId: 'native-source' },
  };
  const childAnswer = {
    id: 'child-answer',
    role: 'assistant',
    content: 'child answer',
    parentId: 'child-user',
    threadId: 'branch',
    metadata: { codexTurnId: 'child-turn', heteroSessionId: 'native-child' },
  };
  const childUser = { id: 'child-user', role: 'user', parentId: source.id, threadId: 'branch' };
  const nextUser = { id: 'next-user', role: 'user', parentId: childAnswer.id, threadId: 'branch' };

  it('leaves ordinary topics and threads to their own resume decision', () => {
    expect(
      resolveCodexBranchRun({
        messageId: nextUser.id,
        messages: [],
        resumeSessionId: 'topic-session',
        thread: { id: 'branch', metadata: {} },
      }),
    ).toEqual({ resumeSessionId: 'topic-session' });
  });

  it('forks from the immutable origin before the branch has a native child', () => {
    expect(
      resolveCodexBranchRun({ messageId: childUser.id, messages: [source, childUser], thread }),
    ).toEqual({ codexForkTarget: origin, resumeSessionId: 'native-source' });
  });

  it('resumes the child recorded on the thread without forking again', () => {
    expect(
      resolveCodexBranchRun({
        messageId: nextUser.id,
        messages: [],
        resumeSessionId: 'native-child',
        thread,
      }),
    ).toEqual({ resumeSessionId: 'native-child' });
  });

  // ROOT CAUSE:
  // The child session is written to the thread and to message provenance separately. When only
  // the thread write failed, a reload used to fork from the source again and drop the branch.
  /** @example The send's own ancestry recovers the child; a newer sibling branch does not. */
  it('recovers the child from its own ancestry when the thread binding was lost', () => {
    const sibling = { ...childAnswer, id: 'sibling', metadata: { heteroSessionId: 'other' } };
    expect(
      resolveCodexBranchRun({
        messageId: nextUser.id,
        messages: [nextUser, sibling, childAnswer, childUser, source],
        // Builds before the immutable origin preset the source as the branch binding.
        resumeSessionId: 'native-source',
        thread,
      }),
    ).toEqual({ resumeSessionId: 'native-child' });
  });

  /** @example A later `codex exec` turn records the child without a native turn ID. */
  it('recovers a child recorded by an exec turn', () => {
    const execAnswer = { ...childAnswer, metadata: { heteroSessionId: 'native-child' } };
    expect(
      resolveCodexBranchRun({ messageId: nextUser.id, messages: [nextUser, execAnswer], thread }),
    ).toEqual({ resumeSessionId: 'native-child' });
  });

  // ROOT CAUSE:
  // When every write of the child session failed, forking from the origin again silently
  // discarded the answer the branch already shows. Refuse instead of losing that history.
  /** @example A visible branch answer without any saved child session stops the run. */
  it('refuses to fork again when the branch shows an answer without a saved child', () => {
    const unsaved = { ...childAnswer, metadata: {} };
    expect(
      resolveCodexBranchRun({
        messageId: nextUser.id,
        messages: [nextUser, unsaved, childUser],
        thread,
      }),
    ).toEqual({
      codexBranchError:
        'This Codex branch lost its native session. Fork again from the original message.',
    });
  });

  /** @example A failed first attempt (error, no answer) retries the fork from its origin. */
  it('retries the fork after a first turn that failed before answering', () => {
    const failed = { ...childAnswer, content: '', error: { type: 'Error' }, metadata: {} };
    const retryUser = { ...nextUser, parentId: failed.id };
    expect(
      resolveCodexBranchRun({ messageId: retryUser.id, messages: [retryUser, failed], thread }),
    ).toEqual({ codexForkTarget: origin, resumeSessionId: 'native-source' });
  });

  it('terminates on cyclic ancestry', () => {
    const cyclic = { ...childUser, parentId: childUser.id };
    expect(resolveCodexBranchRun({ messageId: cyclic.id, messages: [cyclic], thread })).toEqual({
      codexForkTarget: origin,
      resumeSessionId: 'native-source',
    });
  });
});
