import { describe, expect, it } from 'vitest';

import {
  canSubmitInteractiveUI,
  formatInteractiveUIFollowUp,
  getFollowUpDraftValidation,
} from './submission';

const context = {
  busy: false,
  currentContextKey: 'main_agent_topic',
  originalContextKey: 'main_agent_topic',
  readOnly: false,
  source: { plugin: { apiName: 'renderUI', identifier: 'lobe-interactive-ui' }, role: 'tool' },
  target: { contextKey: 'main_agent_topic', writable: true as const },
};

describe('interactive UI host submission', () => {
  it('allows only the source widget in its current writable conversation', () => {
    expect(canSubmitInteractiveUI(context)).toBe(true);
    expect(canSubmitInteractiveUI({ ...context, currentContextKey: 'other-topic' })).toBe(false);
    expect(
      canSubmitInteractiveUI({ ...context, target: { contextKey: 'other-topic', writable: true } }),
    ).toBe(false);
  });
  it('rejects read-only, busy, missing, and unrelated source messages', () => {
    expect(canSubmitInteractiveUI({ ...context, readOnly: true })).toBe(false);
    expect(canSubmitInteractiveUI({ ...context, busy: true })).toBe(false);
    expect(canSubmitInteractiveUI({ ...context, target: { writable: false } })).toBe(false);
    expect(canSubmitInteractiveUI({ ...context, source: undefined })).toBe(false);
    expect(canSubmitInteractiveUI({ ...context, source: { role: 'assistant' } })).toBe(false);
    expect(
      canSubmitInteractiveUI({
        ...context,
        source: { ...context.source, plugin: { identifier: 'other' } },
      }),
    ).toBe(false);
  });
  it('records the UI source without allowing the proposal to set a destination', () => {
    expect(
      formatInteractiveUIFollowUp('Plans', 'tool-1', '  Quantity 500, plan B, cost 50  '),
    ).toBe('[Interactive UI: Plans; source tool message: tool-1]\nQuantity 500, plan B, cost 50');
  });
});

describe('follow-up draft validation', () => {
  it('keeps a long proposal editable and enables sending after it is shortened', () => {
    let draft = 'x'.repeat(2001);
    expect(getFollowUpDraftValidation(draft)).toEqual({ canSend: false, tooLong: true });
    draft = draft.slice(0, 2000);
    expect(getFollowUpDraftValidation(draft)).toEqual({ canSend: true, tooLong: false });
    expect(getFollowUpDraftValidation('   ')).toEqual({ canSend: false, tooLong: false });
  });
});
