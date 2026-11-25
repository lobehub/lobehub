import { A2UI_CATALOG_ID } from '@lobehub/a2ui';
import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('A2UI system prompt', () => {
  it('takes the components and protocol from the package, not a hand-written list', () => {
    expect(systemPrompt).toContain('---BEGIN A2UI JSON SCHEMA---');
    expect(systemPrompt).toContain(A2UI_CATALOG_ID);
    for (const name of ['Table', 'Steps', 'KeyValue', 'Tabs', 'DateTimeInput', 'Metrics'])
      expect(systemPrompt).toContain(`"${name}"`);
  });

  it('keeps the product rules and never prescribes one card layout', () => {
    expect(systemPrompt).toContain('A display card needs no buttons');
    expect(systemPrompt).toContain('Design each card for its content');
    expect(systemPrompt).not.toMatch(/then show the shape of the data with Chart/);
  });
});
