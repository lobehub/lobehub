import { A2UI_CATALOG_ID } from '@lobehub/a2ui';
import { describe, expect, it } from 'vitest';

import { A2uiManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('A2UI tool', () => {
  it('takes its prompt from the package processor: format rules, schemas and examples', () => {
    expect(systemPrompt).toContain('---BEGIN A2UI JSON SCHEMA---');
    expect(systemPrompt).toContain(A2UI_CATALOG_ID);
    expect(systemPrompt).toContain('### Examples:');
    for (const name of ['Tabs', 'DateTimeInput', 'Table', 'Steps', 'Metrics', 'Chart'])
      expect(systemPrompt).toContain(`"${name}"`);
  });

  it('keeps the product layer short and prescribes no layout', () => {
    expect(systemPrompt).toContain('A display card needs no buttons');
    expect(systemPrompt).not.toMatch(/then show the shape of the data with Chart/);
  });

  it('declares the tool as the package defines it', () => {
    expect(A2uiManifest.api[0].name).toBe('renderUI');
    expect(A2uiManifest.api[0].parameters).toMatchObject({ required: ['operations'] });
  });
});
