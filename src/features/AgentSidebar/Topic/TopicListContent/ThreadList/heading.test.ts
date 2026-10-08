import { describe, expect, it } from 'vitest';

import { getThreadListHeadingKey, SUBAGENT_LIST_HEADING, THREAD_LIST_HEADING } from './heading';

describe('getThreadListHeadingKey', () => {
  it('labels a list of tool-spawned subagent threads as Subagents', () => {
    expect(
      getThreadListHeadingKey([
        { metadata: { sourceToolCallId: 'call_1' } },
        { metadata: { sourceToolCallId: 'call_2' } },
      ]),
    ).toBe(SUBAGENT_LIST_HEADING);
  });

  // Regression: keying on `ThreadType.Isolation` labelled a direct `@Agent`
  // thread — an ordinary target-agent conversation, and so without a
  // `sourceToolCallId` — as a subagent.
  it('uses the inclusive heading when the threads are not tool-spawned subagents', () => {
    expect(getThreadListHeadingKey([{ metadata: { sourceToolCallId: 'call_1' } }, {}])).toBe(
      THREAD_LIST_HEADING,
    );
    expect(getThreadListHeadingKey([{}, { metadata: undefined }])).toBe(THREAD_LIST_HEADING);
    expect(getThreadListHeadingKey([{ metadata: { sourceToolCallId: undefined } }])).toBe(
      THREAD_LIST_HEADING,
    );
  });

  it('falls back to the inclusive heading for an empty list', () => {
    expect(getThreadListHeadingKey([])).toBe(THREAD_LIST_HEADING);
  });
});
