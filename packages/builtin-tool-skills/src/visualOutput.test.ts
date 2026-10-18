import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';
import { systemPrompt as desktopSystemPrompt } from './systemRole.desktop';
import { visualOutputPrompt } from './visualOutput';

describe('visualOutputPrompt', () => {
  it('is included in both web and desktop system prompts', () => {
    expect(systemPrompt).toContain(visualOutputPrompt);
    expect(desktopSystemPrompt).toContain(visualOutputPrompt);
  });

  it('routes explanatory visuals inline and deliverables to Artifacts with a fallback', () => {
    expect(visualOutputPrompt).toContain('```mermaid');
    expect(visualOutputPrompt).toMatch(/Explanatory[^\n]*```html/);
    expect(visualOutputPrompt).toMatch(/Deliverables[^\n]*Artifact[^\n]*unavailable[^\n]*```html/);
  });
});
