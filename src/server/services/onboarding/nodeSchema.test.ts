import { describe, expect, it } from 'vitest';

import { getNodeDraftState, normalizeFromSchema } from './nodeSchema';

describe('normalizeFromSchema', () => {
  it('returns undefined for empty input in committed mode', () => {
    expect(normalizeFromSchema('agentIdentity', {}, 'committed')).toBeUndefined();
  });

  it('returns partial draft with only provided string fields', () => {
    const result = normalizeFromSchema('agentIdentity', { vibe: 'warm' }, 'draft');
    expect(result).toEqual({ vibe: 'warm' });
  });

  it('returns undefined for draft when no valid fields present', () => {
    expect(normalizeFromSchema('agentIdentity', { unknown: 'x' }, 'draft')).toBeUndefined();
  });

  it('returns committed only when all required fields present', () => {
    const full = { emoji: '🦊', name: 'Fox', nature: 'AI pal', vibe: 'sharp' };
    expect(normalizeFromSchema('agentIdentity', full, 'committed')).toEqual(full);
  });

  it('returns undefined for committed when required field missing', () => {
    expect(
      normalizeFromSchema(
        'agentIdentity',
        { emoji: '🦊', name: 'Fox', vibe: 'sharp' },
        'committed',
      ),
    ).toBeUndefined();
  });

  it('trims string values and drops empty strings', () => {
    const result = normalizeFromSchema(
      'userIdentity',
      { summary: '  hello  ', name: '  ' },
      'draft',
    );
    expect(result).toEqual({ summary: 'hello' });
  });

  it('handles string array fields with sanitization', () => {
    const result = normalizeFromSchema(
      'workContext',
      { summary: 'ctx', tools: ['  vim  ', '', 'emacs'] },
      'draft',
    );
    expect(result).toEqual({ summary: 'ctx', tools: ['vim', 'emacs'] });
  });

  it('slices string arrays to max 8 items', () => {
    const tools = Array.from({ length: 12 }, (_, i) => `tool-${i}`);
    const result = normalizeFromSchema('workContext', { summary: 'ctx', tools }, 'draft');
    expect(result!.tools).toHaveLength(8);
  });
});

describe('getNodeDraftState', () => {
  it('returns empty status with missing fields when draft is empty', () => {
    const state = getNodeDraftState('agentIdentity', {});
    expect(state).toEqual({
      missingFields: ['emoji', 'name', 'nature', 'vibe'],
      status: 'empty',
    });
  });

  it('returns complete when all required fields present', () => {
    const state = getNodeDraftState('userIdentity', { userIdentity: { summary: 'hi' } });
    expect(state?.status).toBe('complete');
  });

  it('returns undefined for summary node', () => {
    expect(getNodeDraftState('summary', {})).toBeUndefined();
  });

  it('handles responseLanguage as scalar', () => {
    expect(getNodeDraftState('responseLanguage', { responseLanguage: 'zh-CN' })?.status).toBe(
      'complete',
    );
    expect(getNodeDraftState('responseLanguage', {})?.status).toBe('empty');
  });
});
