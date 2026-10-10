import { describe, expect, it } from 'vitest';

import { buildCodexBranchParams } from './codexBranch';

describe('buildCodexBranchParams', () => {
  const source = {
    id: 'original-user',
    role: 'user' as const,
    content: 'original',
    editorData: { attachment: 'image-1' },
    imageList: [{ id: 'image-1', url: 'https://example.test/image.png', alt: 'image' }],
    fileList: [
      {
        id: 'file-1',
        name: 'document.txt',
        size: 10,
        fileType: 'text/plain',
        url: 'https://example.test/doc.txt',
      },
    ],
    metadata: { codexTurnId: 'turn-7', heteroSessionId: 'native-source', activeBranchIndex: 2 },
    threadId: 'parent-branch',
  };
  const context = { agentId: 'agent', topicId: 'topic', threadId: 'parent-branch' };
  const workingDirectory = '/work/project';

  it('creates a replayed prompt and exclusive child without modifying the source', () => {
    const before = structuredClone(source);
    const result = buildCodexBranchParams({ context, source, workingDirectory });
    expect(source).toEqual(before);
    expect(result.threadParams).toMatchObject({
      parentThreadId: 'parent-branch',
      sourceMessageId: 'original-user',
      topicId: 'topic',
      type: 'continuation',
      metadata: {
        sourceMessageExcluded: true,
        codexForkTarget: { position: 'before', threadId: 'native-source', turnId: 'turn-7' },
        workingDirectory: '/work/project',
      },
    });
    expect(result.messageParams).toMatchObject({
      agentId: 'agent',
      topicId: 'topic',
      role: 'user',
      content: 'original',
      editorData: { attachment: 'image-1' },
      files: ['file-1', 'image-1'],
    });
    expect(result.messageParams?.metadata).not.toHaveProperty('codexTurnId');
    expect(result.messageParams?.metadata).not.toHaveProperty('activeBranchIndex');
  });

  it('forks at a user prompt without retaining its old native answer', () => {
    const result = buildCodexBranchParams({ context, source, workingDirectory });
    expect(result.threadParams.metadata).toMatchObject({
      sourceMessageExcluded: true,
      codexForkTarget: { position: 'before', threadId: 'native-source', turnId: 'turn-7' },
    });
    expect(result.messageParams).toMatchObject({
      role: 'user',
      content: 'original',
      files: ['file-1', 'image-1'],
    });
  });

  it('stages an inclusive native fork without inventing a user message', () => {
    const result = buildCodexBranchParams({
      context,
      source: { ...source, role: 'assistant' },
      workingDirectory,
    });
    expect(result.messageParams).toBeUndefined();
    expect(result.threadParams.metadata).toMatchObject({
      sourceMessageExcluded: false,
      codexForkTarget: { position: 'after', threadId: 'native-source', turnId: 'turn-7' },
    });
  });

  // ROOT CAUSE:
  // The child used to start with the source session as its own resume binding, so any lost
  // write left the branch pointing at the source. The child now only carries its origin.
  /** @example A new branch has nothing to resume until its own first turn records a child. */
  it('never gives the child a resumable session of its own', () => {
    const { threadParams } = buildCodexBranchParams({ context, source, workingDirectory });
    expect(threadParams.metadata).not.toHaveProperty('heteroSessionId');
    expect(threadParams.metadata).not.toHaveProperty('heteroSessionIdByWorkingDirectory');
    expect(threadParams.metadata).not.toHaveProperty('heteroSessionBindingKey');
  });

  // ROOT CAUSE:
  // A user-message fork is titled by createThreadWithMessage from its replayed prompt, but an
  // assistant fork is created without a message and no title, so Subtopics showed a blank row.
  /** @example Both fork kinds get the same plain-text, 80-character title from their source. */
  it('titles an assistant fork from its source like a user-message fork', () => {
    const { threadParams } = buildCodexBranchParams({
      context,
      source: { ...source, role: 'assistant', content: `**Plan** ${'x'.repeat(100)}` },
      workingDirectory,
    });
    expect(threadParams.title).toBe(`Plan ${'x'.repeat(75)}`);
    expect(buildCodexBranchParams({ context, source, workingDirectory }).threadParams.title).toBe(
      'original',
    );
  });
});
