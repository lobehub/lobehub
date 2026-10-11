import { describe, expect, it } from 'vitest';

import { LobeHubSkill } from './index';

/**
 * The goal module used to exist nowhere in this skill: agents learned the `lh`
 * CLI from these tables, so `lh goal` was invisible unless the user typed
 * `/goal`. These guard the wiring that makes it discoverable — a reference that
 * is registered but unlisted (or vice versa) reproduces the original gap.
 */
describe('lobehub skill goal module', () => {
  it('registers the goal reference', () => {
    expect(LobeHubSkill.resources?.['references/goal']).toBeDefined();
  });

  it('lists lh goal in the platform guide so agents discover it without /goal', () => {
    expect(LobeHubSkill.content).toContain('`lh goal`');
  });

  it('documents set-requirement alongside the command it describes', () => {
    expect(LobeHubSkill.resources?.['references/goal']?.content).toContain('set-requirement');
  });
});
