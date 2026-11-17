import { describe, expect, it } from 'vitest';

import { applyWakeForm, toWakeForm } from './wakeForm';

describe('toWakeForm', () => {
  it('reads a Channel with no strategy as the defaults', () => {
    expect(toWakeForm(null)).toEqual({
      customInstructions: '',
      customInstructionsEnabled: false,
      duties: '',
      enabled: true,
      pace: 'balanced',
    });
  });

  it('reads a strategy without a pace as custom', () => {
    expect(toWakeForm({ enabled: false }).pace).toBe('custom');
  });

  it('treats instructions saved without the switch as on', () => {
    expect(toWakeForm({ customInstructions: 'old' }).customInstructionsEnabled).toBe(true);
  });

  it('keeps the text of instructions that are switched off', () => {
    const form = toWakeForm({ customInstructions: 'old', customInstructionsEnabled: false });
    expect(form).toMatchObject({ customInstructions: 'old', customInstructionsEnabled: false });
  });
});

describe('applyWakeForm', () => {
  it('keeps the fields the form does not edit', () => {
    const stored = {
      duties: { text: 'bills', threshold: 0.5 },
      pace: 'calm' as const,
      rules: { scope: 'none' },
    };
    expect(applyWakeForm(stored, { ...toWakeForm(stored), duties: ' refunds ' })).toMatchObject({
      duties: { text: 'refunds', threshold: 0.5 },
      pace: 'calm',
      rules: { scope: 'none' },
    });
  });

  it('adds no duties block to a Channel that never had duties', () => {
    expect(applyWakeForm(null, toWakeForm(null))).not.toHaveProperty('duties');
  });
});
