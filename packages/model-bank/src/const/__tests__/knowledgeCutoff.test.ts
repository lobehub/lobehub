import { describe, expect, it } from 'vitest';

import {
  getModelKnowledgeCutoff,
  MODEL_KNOWLEDGE_CUTOFFS,
  normalizeModelIdForCutoff,
} from '../knowledgeCutoff';

describe('MODEL_KNOWLEDGE_CUTOFFS', () => {
  it('every value is a YYYY-MM date', () => {
    for (const [id, cutoff] of Object.entries(MODEL_KNOWLEDGE_CUTOFFS)) {
      expect(cutoff, `cutoff of ${id}`).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    }
  });

  it('every key is in normal form, so the entry is reachable', () => {
    for (const id of Object.keys(MODEL_KNOWLEDGE_CUTOFFS)) {
      expect(normalizeModelIdForCutoff(id), `key ${id}`).toBe(id);
    }
  });
});

describe('normalizeModelIdForCutoff', () => {
  it.each([
    // aggregator path prefixes
    ['openai/gpt-5.2-chat', 'gpt-5.2-chat'],
    ['anthropic/claude-3.5-sonnet', 'claude-3-5-sonnet'],
    ['@cf/meta/llama-4-scout-17b-16e-instruct', 'llama-4-scout-17b-16e-instruct'],
    // bedrock region/vendor prefixes + version suffixes
    ['global.anthropic.claude-opus-4-5-20251101-v1:0', 'claude-opus-4-5'],
    ['us.anthropic.claude-3-7-sonnet-20250219-v1:0', 'claude-3-7-sonnet'],
    ['meta.llama3-1-8b-instruct-v1:0', 'llama3-1-8b-instruct'],
    // dated snapshots and revisions
    ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5'],
    ['gpt-4o-2024-11-20', 'gpt-4o'],
    ['o3-2025-04-16', 'o3'],
    ['gemini-2.0-flash-001', 'gemini-2.0-flash'],
    ['gemini-2.5-flash-preview-04-17', 'gemini-2.5-flash'],
    // serving variants, stacked suffixes
    ['claude-opus-4-1-20250805-thinking', 'claude-opus-4-1'],
    ['claude-opus-4.6-fast', 'claude-opus-4-6'],
    ['claude-3-5-haiku-latest', 'claude-3-5-haiku'],
    ['Meta-Llama-4-Maverick-17B-128E-Instruct-FP8', 'llama-4-maverick-17b-128e-instruct'],
    ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'llama-3.3-70b-instruct'],
    ['xai/grok-3-mini-fast', 'grok-3-mini'],
    ['gemini-3.1-pro-preview', 'gemini-3.1-pro'],
    // ollama size tags
    ['gpt-oss:120b', 'gpt-oss-120b'],
    // 4-digit suffixes are ambiguous and must NOT be treated as dates
    ['grok-4.20-multi-agent-0309', 'grok-4.20-multi-agent-0309'],
    ['gpt-4-0613', 'gpt-4-0613'],
    ['command-a-03-2025', 'command-a-03-2025'],
  ])('%s → %s', (raw, normalized) => {
    expect(normalizeModelIdForCutoff(raw)).toBe(normalized);
  });
});

describe('getModelKnowledgeCutoff', () => {
  it('resolves cutoffs across provider-specific spellings of the same model', () => {
    // one model, four spellings, one answer
    expect(getModelKnowledgeCutoff('claude-sonnet-4-6')).toBe('2025-05');
    expect(getModelKnowledgeCutoff('claude-sonnet-4.6')).toBe('2025-05');
    expect(getModelKnowledgeCutoff('global.anthropic.claude-sonnet-4-6')).toBe('2025-05');
    expect(getModelKnowledgeCutoff('anthropic/claude-sonnet-4.6')).toBe('2025-05');
  });

  it('returns undefined for models without a documented cutoff', () => {
    // providers that don't publish cutoffs stay empty rather than guessed
    expect(getModelKnowledgeCutoff('deepseek-v4-pro')).toBeUndefined();
    expect(getModelKnowledgeCutoff('qwen3.7-max')).toBeUndefined();
    expect(getModelKnowledgeCutoff('glm-5.1')).toBeUndefined();
    expect(getModelKnowledgeCutoff('kimi-k2.6')).toBeUndefined();
    expect(getModelKnowledgeCutoff('mistral-large-2512')).toBeUndefined();
    // distills / derivatives must not inherit the base family cutoff
    expect(getModelKnowledgeCutoff('deepseek-r1-distill-llama-70b')).toBeUndefined();
  });
});
