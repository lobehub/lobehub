import { describe, expect, it } from 'vitest';

import chat from './chat';

describe('task acceptance labels', () => {
  it('distinguishes acceptance criteria configuration from delivery results', () => {
    expect(chat['verifyConfig.title']).toBe('Acceptance criteria');
    expect(chat['taskDetail.acceptance.title']).toBe('Delivery acceptance');
    expect(chat['verifyConfig.title']).not.toBe(chat['taskDetail.acceptance.title']);
  });
});
