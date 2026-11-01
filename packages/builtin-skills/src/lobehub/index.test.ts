import { describe, expect, it } from 'vitest';

import { LobeHubSkill } from './index';

const referencedPaths = (text: string) =>
  [...new Set(text.match(/references\/[\w/-]+/g) ?? [])].map((path) => path.replace(/\/$/, ''));

describe('LobeHubSkill', () => {
  it('registers every reference the guide points to', () => {
    const resources = Object.keys(LobeHubSkill.resources ?? {});
    const contents = [
      LobeHubSkill.content,
      ...Object.values(LobeHubSkill.resources ?? {}).map((r) => r.content),
    ];

    for (const path of contents.flatMap((text) => referencedPaths(text ?? ''))) {
      expect(resources, `${path} is referenced but not registered`).toContain(path);
    }
  });

  it('documents workspace scope in the guide', () => {
    expect(LobeHubSkill.content).toContain('`lh workspace`');
    expect(LobeHubSkill.content).toContain('references/workspace');
  });
});
