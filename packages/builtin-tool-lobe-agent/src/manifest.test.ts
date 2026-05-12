import { describe, expect, it } from 'vitest';

import { LobeAgentManifest } from './manifest';

describe('LobeAgentManifest', () => {
  it('should keep the package metadata generic for future Lobe Agent capabilities', () => {
    expect(LobeAgentManifest.meta.avatar).toBe('🤖');
    expect(LobeAgentManifest.meta.description).toBe(
      'Run built-in Lobe Agent capabilities: plan + todo management, sub-agent dispatch, and visual media analysis.',
    );
    expect(LobeAgentManifest.meta.readme).toContain(
      'built-in assistant capabilities that can be expanded over time',
    );
  });

  it('should describe visual analysis as a fallback tool', () => {
    const apiDescription = LobeAgentManifest.api[0].description;

    expect(apiDescription).toContain('native multimodal capability');
    expect(apiDescription).toContain('use this tool only as a fallback');
    expect(apiDescription).toContain('Provide either refs or urls');
    expect(apiDescription).toContain('Prefer refs when stable refs are available');
    expect(apiDescription).toContain('msg_xxx.image_1');
    expect(apiDescription).toContain('use urls only for direct media URLs');
    expect(apiDescription).toContain('answer the user directly with the result');
  });

  it('should keep visual analysis parameters compatible with strict tool schema validators', () => {
    const parameters = LobeAgentManifest.api[0].parameters;

    expect(parameters).not.toHaveProperty('oneOf');
    expect(parameters).not.toHaveProperty('allOf');
    expect(parameters).not.toHaveProperty('anyOf');
  });
});
