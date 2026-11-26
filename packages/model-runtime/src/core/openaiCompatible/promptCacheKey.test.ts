import { describe, expect, it } from 'vitest';

import { PROMPT_CACHE_KEY_MAX_LENGTH, resolvePromptCacheKey } from './promptCacheKey';

// Synthetic identifiers from https://github.com/lobehub/lobehub/issues/20977: the
// naive `lobe:${user}:${model}` key for these 32- and 33-character parts is 71 long.
const longUser = `user_${'a'.repeat(27)}`;
const longModel = 'gpt-4o@preset/example-cache-tests';

const rawKey = (model: string, user: string) => `lobe:${user}:${model}`;

describe('resolvePromptCacheKey', () => {
  it('returns undefined without a user', () => {
    expect(resolvePromptCacheKey('gpt-4o')).toBeUndefined();
    expect(resolvePromptCacheKey('gpt-4o', '')).toBeUndefined();
  });

  it('returns undefined for models without prompt-cache support', () => {
    expect(resolvePromptCacheKey('llama-3.1-8b-instant', 'testUser')).toBeUndefined();
  });

  it('keeps the readable key for supported short models', () => {
    expect(resolvePromptCacheKey('gpt-4o', 'testUser')).toBe('lobe:testUser:gpt-4o');
    expect(resolvePromptCacheKey('o3-mini', 'testUser')).toBe('lobe:testUser:o3-mini');
    expect(resolvePromptCacheKey('chat-latest', 'testUser')).toBe('lobe:testUser:chat-latest');
  });

  it('honours provider opt-in models', () => {
    expect(resolvePromptCacheKey('claude-3-7-sonnet', 'testUser')).toBeUndefined();
    expect(resolvePromptCacheKey('claude-3-7-sonnet', 'testUser', ['claude'])).toBe(
      'lobe:testUser:claude-3-7-sonnet',
    );
    expect(resolvePromptCacheKey('gemini-2.5-pro', 'testUser', [/^gemini-/])).toBe(
      'lobe:testUser:gemini-2.5-pro',
    );
  });

  it('bounds the automatic key below the provider 64-character limit', () => {
    const key = resolvePromptCacheKey(longModel, longUser);

    expect(rawKey(longModel, longUser)).toHaveLength(71);
    expect(key).toBeDefined();
    expect(key!.length).toBeLessThanOrEqual(PROMPT_CACHE_KEY_MAX_LENGTH);
    expect(key).toMatch(/^lobe:[a-f0-9]+$/);
  });

  it('leaves a key that is exactly at the boundary untouched', () => {
    const user = 'u'.repeat(32);
    const model = `gpt-${'a'.repeat(22)}`;

    expect(rawKey(model, user)).toHaveLength(PROMPT_CACHE_KEY_MAX_LENGTH);
    expect(resolvePromptCacheKey(model, user)).toBe(rawKey(model, user));
  });

  it('hashes keys that exceed the boundary', () => {
    const user = 'u'.repeat(32);
    const model = `gpt-${'a'.repeat(23)}`;

    expect(rawKey(model, user)).toHaveLength(PROMPT_CACHE_KEY_MAX_LENGTH + 1);

    const key = resolvePromptCacheKey(model, user);

    expect(key).not.toBe(rawKey(model, user));
    expect(key!.length).toBeLessThanOrEqual(PROMPT_CACHE_KEY_MAX_LENGTH);
  });

  it('is deterministic', () => {
    expect(resolvePromptCacheKey(longModel, longUser)).toBe(
      resolvePromptCacheKey(longModel, longUser),
    );
  });

  it('keeps different users and models in different buckets', () => {
    const key = resolvePromptCacheKey(longModel, longUser);

    expect(resolvePromptCacheKey(longModel, `${longUser}x`)).not.toBe(key);
    expect(resolvePromptCacheKey(`${longModel}x`, longUser)).not.toBe(key);
  });

  it('keeps identities that only differ by the delimiter in different buckets', () => {
    // `lobe:${user}:${model}` cannot tell these two identities apart, but hashing
    // the structured `[user, model]` pair keeps them distinct.
    const userA = `${'u'.repeat(30)}:aa`;
    const modelA = 'm'.repeat(30);
    const userB = 'u'.repeat(30);
    const modelB = `aa:${'m'.repeat(30)}`;

    expect(`${userA}:${modelA}`).toBe(`${userB}:${modelB}`);
    expect(resolvePromptCacheKey(modelA, userA, ['m'])).not.toBe(
      resolvePromptCacheKey(modelB, userB, ['m']),
    );
  });
});
