import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('Goal systemPrompt', () => {
  it('hands successful goal execution off instead of duplicating it', () => {
    expect(systemPrompt).toContain('the work has been handed off to a separate task topic');
    expect(systemPrompt).toContain(
      'do not perform, reproduce, preview, or self-check the requested work in the current conversation',
    );
    expect(systemPrompt).toContain('its live card shows progress');
  });
});
