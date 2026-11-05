import { describe, expect, it } from 'vitest';

import { classifyPersonalRead } from './readEvidence';

describe('personal read proof', () => {
  it('requires provider records, not a successful envelope or model statement', () => {
    expect(
      classifyPersonalRead({ success: true, content: 'I read your Gmail successfully.' }),
    ).toMatchObject({ outcome: 'unverified' });
    expect(
      classifyPersonalRead({ success: true, content: JSON.stringify({ messages: [] }) }),
    ).toMatchObject({ outcome: 'empty', recordCount: 0 });
    expect(
      classifyPersonalRead({
        success: false,
        content: JSON.stringify({ messages: [{ id: 'm1', subject: 'Invoice' }] }),
      }),
    ).toMatchObject({ outcome: 'failed' });
    expect(
      classifyPersonalRead({
        success: true,
        content: JSON.stringify({ messages: [{ id: 'm1', subject: 'Invoice' }] }),
      }),
    ).toMatchObject({ outcome: 'data', recordCount: 1 });
  });
});
