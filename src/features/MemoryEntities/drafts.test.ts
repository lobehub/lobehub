import { beforeEach, describe, expect, it } from 'vitest';

import { resolveDraft, useDraftStore } from './drafts';

describe('resolveDraft', () => {
  it('saves a cleared description instead of silently keeping the old one', () => {
    expect(resolveDraft('   ', 'Old description')).toEqual({ save: true, value: '' });
  });

  it('treats unchanged text as a no-op', () => {
    expect(resolveDraft(' Old description ', 'Old description')).toEqual({
      save: false,
      value: 'Old description',
    });
  });
});

describe('useDraftStore', () => {
  beforeEach(() => useDraftStore.setState({ drafts: {} }));

  it('keeps an unsaved edit per context across switching away and back', () => {
    const { setDraft } = useDraftStore.getState();
    setDraft('ctx-a', 'half-typed');
    setDraft('ctx-b', 'other page');

    expect(useDraftStore.getState().drafts).toEqual({ 'ctx-a': 'half-typed', 'ctx-b': 'other page' });

    setDraft('ctx-a');
    expect(useDraftStore.getState().drafts).toEqual({ 'ctx-b': 'other page' });
  });
});
