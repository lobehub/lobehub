import { A2UI_CATALOG_ID } from '@lobehub/a2ui/constants';
import { describe, expect, it } from 'vitest';

import { A2uiExecutionRuntime } from './ExecutionRuntime';
import { A2uiManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('A2UI tool', () => {
  it('injects the package’s progressive prompt: an index of every component, no schema block', () => {
    expect(systemPrompt).toContain(A2UI_CATALOG_ID);
    expect(systemPrompt).toContain('### Examples:');
    expect(systemPrompt).not.toContain('---BEGIN A2UI JSON SCHEMA---');
    for (const name of ['Tabs', 'DateTimeInput', 'Table', 'Steps', 'Metrics', 'Chart'])
      expect(systemPrompt).toContain(`- ${name}(`);
    expect(systemPrompt.length).toBeLessThan(16_000);
  });

  it('keeps the product layer short and prescribes no layout', () => {
    expect(systemPrompt).toContain('A display card needs no buttons');
    expect(systemPrompt).not.toMatch(/then show the shape of the data with Chart/);
  });

  it('declares both APIs as the package defines them', () => {
    expect(A2uiManifest.api.map((api) => api.name)).toEqual(['renderUI', 'readCardDocs']);
    expect(A2uiManifest.api[0].parameters).toMatchObject({ required: ['operations'] });
    expect(A2uiManifest.api[1].parameters).toMatchObject({ required: ['components'] });
  });

  it('reads the full schema of the components a card will use', async () => {
    const result = await new A2uiExecutionRuntime().readCardDocs({ components: ['Chart'] });
    expect(result.success).toBe(true);
    expect(result.content).toContain('---BEGIN A2UI JSON SCHEMA---');
    expect(result.content).toContain('"Chart"');
  });

  // The guide reaches every run that may draw a card, most of which have no lobe-channel tool; how
  // to post a card elsewhere belongs to that tool's own guide.
  it('does not point to a tool the run may not have', () => {
    expect(systemPrompt).not.toContain('lobe-channel');
    expect(systemPrompt).not.toContain('postMessage');
  });
});
