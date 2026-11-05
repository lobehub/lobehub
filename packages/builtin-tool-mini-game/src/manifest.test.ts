import { describe, expect, it } from 'vitest';

import { MiniGameManifest } from './manifest';
import { PIXEL_YARD_SCENE } from './scene';
import { MiniGameApiName, MiniGameIdentifier } from './types';

describe('MiniGameManifest', () => {
  it('declares every API with a schema and a timeout, client-executed only', () => {
    expect(MiniGameManifest.identifier).toBe(MiniGameIdentifier);
    expect(MiniGameManifest.executors).toEqual(['client']);
    expect(MiniGameManifest.api.map((api) => api.name).sort()).toEqual(
      Object.values(MiniGameApiName).sort(),
    );
    for (const api of MiniGameManifest.api) {
      expect(api.parameters.type).toBe('object');
      expect(api.defaultTimeoutMs).toBeGreaterThan(0);
    }
  });

  it('teaches the model to answer first, use only real ids and refuse impossible asks', () => {
    const prompt = MiniGameManifest.systemRole!;
    for (const object of PIXEL_YARD_SCENE.objects) expect(prompt).toContain(object.id);
    expect(prompt).toContain('first write one short, natural reply');
    expect(prompt).toContain('do NOT call any tool');
    expect(prompt).toContain('<context_selection source="game">');
  });
});
