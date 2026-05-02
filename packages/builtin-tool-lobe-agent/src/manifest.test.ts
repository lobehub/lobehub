import { describe, expect, it } from 'vitest';

import { LobeAgentManifest } from './manifest';

describe('LobeAgentManifest', () => {
  it('should keep the package metadata generic for future Lobe Agent capabilities', () => {
    expect(LobeAgentManifest.meta.avatar).toBe('🤖');
    expect(LobeAgentManifest.meta.description).toBe('Run built-in Lobe Agent capabilities.');
    expect(LobeAgentManifest.meta.readme).toContain(
      'built-in assistant capabilities that can be expanded over time',
    );
  });

  it('should describe visual analysis as a fallback tool', () => {
    const apiDescription = LobeAgentManifest.api[0].description;

    expect(apiDescription).toContain('native multimodal capability');
    expect(apiDescription).toContain('use this tool only as a fallback');
    expect(apiDescription).toContain('msg_xxx.image_1');
    expect(apiDescription).toContain('Use only stable refs');
    expect(apiDescription).toContain('answer the user directly with the result');
  });
});
