import { describe, expect, it } from 'vitest';

import { agentShareSystemPrompt } from './resolveRestrictedManifest';
import { systemPrompt } from './systemRole';
import { systemPrompt as desktopSystemPrompt } from './systemRole.desktop';
import { visualOutputPrompt } from './visualOutput';

describe('visualOutputPrompt', () => {
  it('is included in the web, desktop and agent share system prompts', () => {
    expect(systemPrompt).toContain(visualOutputPrompt);
    expect(desktopSystemPrompt).toContain(visualOutputPrompt);
    expect(agentShareSystemPrompt).toContain(visualOutputPrompt);
  });

  it('routes explanatory visuals inline and deliverables to Artifacts with a fallback', () => {
    expect(visualOutputPrompt).toContain('```mermaid');
    expect(visualOutputPrompt).toMatch(/Explanatory[^\n]*```html/);
    expect(visualOutputPrompt).toMatch(/Deliverables[^\n]*Artifact[^\n]*unavailable[^\n]*```html/);
    expect(visualOutputPrompt).toContain('<!DOCTYPE html>');
  });

  it('sends dashboards to Canvas when available and builds without asking for data first', () => {
    expect(visualOutputPrompt).toMatch(
      /dashboards[^\n]*`lobe-canvas`[^\n]*otherwise[^\n]*deliverables/,
    );
    expect(visualOutputPrompt).toMatch(/instead of first asking[^\n]*sample data/);
  });

  it('activates Artifacts before building deliverables and exports requested files directly', () => {
    expect(visualOutputPrompt).toMatch(/Deliverables[^\n]*activateSkill[^\n]*first/);
    expect(visualOutputPrompt).toMatch(
      /explicitly asks for a downloadable file[^\n]*export[^\n]*directly/,
    );
  });
});
