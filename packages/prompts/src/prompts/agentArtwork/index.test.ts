import { describe, expect, it } from 'vitest';

import { AGENT_ARTWORK_STYLES, buildAgentArtworkPrompt } from './index';

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

  it('defaults to the lobe mascot style direction', () => {
    const prompt = buildAgentArtworkPrompt({ id: 'agent-1', kind: 'avatar' });

    expect(prompt).toContain('one vivid contrasting solid background color');
    expect(prompt).toContain('mascot-style 3D emoji character');
    expect(prompt).toContain('never blank or babyish');
    expect(prompt).toContain('friendly likeable color');
    expect(prompt).not.toContain('smirk');
  });

  it('swaps the character-shaped lobe direction for a style-only one on covers', () => {
    const prompt = buildAgentArtworkPrompt({ id: 'agent-1', kind: 'background', style: 'lobe' });

    expect(prompt).toContain('soft 3D cartoon world');
    expect(prompt).not.toContain('big lively glossy eyes');
  });

  it('describes attached style references and fences off subjects and proportions', () => {
    const prompt = buildAgentArtworkPrompt({
      id: 'agent-1',
      kind: 'avatar',
      styleReferenceImageUrls: ['https://example.com/ref-a.webp', 'https://example.com/ref-b.webp'],
    });

    expect(prompt).toContain('as the target character style');
    expect(prompt).toContain('Do not copy their exact faces, hats, or subjects');
  });

  it('uses singular wording for a single style reference', () => {
    const prompt = buildAgentArtworkPrompt({
      id: 'agent-1',
      kind: 'background',
      styleReferenceImageUrls: ['https://example.com/ref-a.webp'],
    });

    expect(prompt).toContain('only as a rendering-style reference');
  });

  it('lets style references suppress the counterpart artwork reference', () => {
    const prompt = buildAgentArtworkPrompt({
      id: 'agent-1',
      kind: 'avatar',
      referenceImageUrl: 'https://example.com/background.png',
      styleReferenceImageUrls: ['https://example.com/ref-a.webp'],
    });

    expect(prompt).toContain('as the target character style');
    expect(prompt).not.toContain('attached existing profile background');
  });

  it('renders a distinct direction for every style preset', () => {
    const prompts = AGENT_ARTWORK_STYLES.map((style) =>
      buildAgentArtworkPrompt({ id: 'agent-1', kind: 'background', style }),
    );

    expect(new Set(prompts).size).toBe(AGENT_ARTWORK_STYLES.length);
    expect(prompts.find((p) => p.includes('watercolor'))).toBeTruthy();
    expect(prompts.find((p) => p.includes('pixel art'))).toBeTruthy();
    expect(prompts.find((p) => p.includes('die-cut sticker'))).toBeTruthy();
  });

  it('applies the chosen style to both avatar and background prompts', () => {
    const avatar = buildAgentArtworkPrompt({ id: 'agent-1', kind: 'avatar', style: 'clay' });
    const background = buildAgentArtworkPrompt({
      id: 'agent-1',
      kind: 'background',
      style: 'clay',
    });

    expect(avatar).toContain('clay-style figure');
    expect(background).toContain('clay-style figure');
  });

  it('steers the motif away from generic technology clichés in every prompt', () => {
    for (const kind of ['avatar', 'background'] as const) {
      const prompt = buildAgentArtworkPrompt({ id: 'agent-1', kind });

      expect(prompt).toContain('Avoid generic AI and technology clichés');
    }
  });

  it('keeps the style direction authoritative over the reference image style', () => {
    const prompt = buildAgentArtworkPrompt({
      id: 'designer',
      kind: 'background',
      referenceImageUrl: 'https://example.com/avatar.png',
      style: 'watercolor',
    });

    expect(prompt).toContain('hand-painted watercolor');
    expect(prompt).not.toContain('illustration style');
  });
});
