import { describe, expect, it } from 'vitest';

import { buildAgentArtworkPrompt } from './index';

describe('buildAgentArtworkPrompt', () => {
  it('injects escaped Agent identity and description into the avatar prompt', () => {
    const prompt = buildAgentArtworkPrompt({
      description: 'Helps with TypeScript & React',
      id: 'agent-1',
      kind: 'avatar',
      name: 'Coco "Coder"',
      title: 'Coding assistant',
    });

    expect(prompt).toContain(
      '<agent id="agent-1" name="Coco &quot;Coder&quot;" title="Coding assistant">',
    );
    expect(prompt).toContain('<description>Helps with TypeScript &amp; React</description>');
    expect(prompt).toContain('full-bleed composition');
    expect(prompt).toContain('square profile icon');
  });

  it('includes the system role in a wide background prompt', () => {
    const prompt = buildAgentArtworkPrompt({
      id: 'researcher',
      kind: 'background',
      systemRole: 'Find and synthesize reliable evidence.',
    });

    expect(prompt).toContain('<system_role>Find and synthesize reliable evidence.</system_role>');
    expect(prompt).toContain('wide cinematic profile cover');
  });

  it('coordinates a background with an attached avatar reference', () => {
    const prompt = buildAgentArtworkPrompt({
      id: 'designer',
      kind: 'background',
      referenceImageUrl: 'https://example.com/avatar.png',
    });

    expect(prompt).toContain('attached existing avatar as the visual source of truth');
    expect(prompt).toContain('dominant color palette');
    expect(prompt).toContain('Do not enlarge, repeat, or place the avatar itself in the cover');
  });

  it('coordinates an avatar with an attached background reference', () => {
    const prompt = buildAgentArtworkPrompt({
      id: 'designer',
      kind: 'avatar',
      referenceImageUrl: 'https://example.com/background.png',
    });

    expect(prompt).toContain('attached existing profile background as the visual source of truth');
    expect(prompt).toContain('same identity system');
  });
});
