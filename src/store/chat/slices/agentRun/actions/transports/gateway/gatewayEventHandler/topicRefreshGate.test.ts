import { describe, expect, it } from 'vitest';

import { makeEvent } from '../testUtils';
import { createTopicRefreshGate } from './topicRefreshGate';

const toolEnd = makeEvent('tool_end', { isSuccess: true });
const skippedToolEnd = makeEvent('tool_end', { isSuccess: true, skipMessageFetch: true });
const completion = makeEvent('step_complete', { phase: 'execution_complete' });

describe('createTopicRefreshGate', () => {
  it('keeps only the newest queued tool_end read', () => {
    const gate = createTopicRefreshGate('gateway');
    const first = gate.toolEnd(toolEnd);
    const second = gate.toolEnd(toolEnd);

    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('does not let a hetero tool_end that skips its fetch supersede an earlier read', () => {
    const gate = createTopicRefreshGate('hetero');
    const read = gate.toolEnd(toolEnd);
    const skipped = gate.toolEnd(skippedToolEnd);

    expect(skipped()).toBe(false);
    expect(read()).toBe(true);
  });

  it('needs the execution_complete read until a message revision arrives', () => {
    const gate = createTopicRefreshGate('gateway');
    expect(gate.completionNeedsRefresh(completion)).toBe(true);

    gate.markRevisionSeen();
    expect(gate.completionNeedsRefresh(completion)).toBe(false);
  });
});
