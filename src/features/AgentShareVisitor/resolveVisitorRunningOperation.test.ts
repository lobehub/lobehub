import { describe, expect, it } from 'vitest';

import { resolveVisitorRunningOperation } from './resolveVisitorRunningOperation';

describe('resolveVisitorRunningOperation', () => {
  it('returns undefined when there is no active topic', () => {
    expect(
      resolveVisitorRunningOperation(
        [{ id: 't-1', runningOperation: { assistantMessageId: 'a', operationId: 'op' } }],
        undefined,
      ),
    ).toBeUndefined();
  });

  it('returns undefined when the topic list has not loaded yet', () => {
    expect(resolveVisitorRunningOperation(undefined, 't-1')).toBeUndefined();
  });

  it('returns undefined when the active topic has no running operation', () => {
    expect(
      resolveVisitorRunningOperation([{ id: 't-1', runningOperation: null }], 't-1'),
    ).toBeUndefined();
  });

  it('returns undefined when the active topic is not in the list', () => {
    expect(
      resolveVisitorRunningOperation(
        [{ id: 't-other', runningOperation: { assistantMessageId: 'a', operationId: 'op' } }],
        't-1',
      ),
    ).toBeUndefined();
  });

  it('returns the matching topic runningOperation', () => {
    const runningOperation = {
      assistantMessageId: 'ast-1',
      heteroType: 'claude-code',
      operationId: 'op-1',
      scope: 'main',
      threadId: 'thd-1',
    };

    expect(
      resolveVisitorRunningOperation(
        [
          { id: 't-other', runningOperation: null },
          { id: 't-1', runningOperation },
        ],
        't-1',
      ),
    ).toEqual(runningOperation);
  });
});
