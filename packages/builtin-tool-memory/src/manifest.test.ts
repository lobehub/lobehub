import { describe, expect, it } from 'vitest';

import { MemoryManifest } from './manifest';
import { systemPrompt } from './systemRole';
import { MemoryApiName } from './types';

describe('MemoryManifest', () => {
  /**
   * @example
   * Experience memory is retired: the model must not be able to write one, and the
   * system role must not advertise the API. Reads of existing rows stay untouched.
   */
  it('does not publish the retired experience write to the model', () => {
    const apiNames = MemoryManifest.api.map((api) => api.name);

    expect(apiNames).not.toContain(MemoryApiName.addExperienceMemory);
    expect(systemPrompt).not.toContain(MemoryApiName.addExperienceMemory);
  });

  /**
   * @example
   * Nor can the model search that layer: neither `layers` nor `topK` offer it, and the
   * system role no longer describes it.
   */
  it('does not offer the retired experience layer to search', () => {
    const search = MemoryManifest.api.find((api) => api.name === MemoryApiName.searchUserMemory);
    const params = search?.parameters as {
      properties: {
        layers: { items: { enum: string[] } };
        topK: { properties: Record<string, unknown> };
      };
    };

    expect(params.properties.layers.items.enum).not.toContain('experience');
    expect(Object.keys(params.properties.topK.properties)).not.toContain('experiences');
    expect(systemPrompt).not.toMatch(/experience layer/i);
  });
});
