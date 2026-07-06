import { deepseek as deepseekChatModels } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { ContextExceededPreFlightError } from '../../utils/resolveSafeMaxTokens';
import { buildDeepSeekAnthropicPayload } from './chatPayload';

describe('buildDeepSeekAnthropicPayload — completion budget', () => {
  // The dynamic-reservation fix engages only when resolveSafeMaxTokens can look
  // up the model card. If these fields ever change/disappear, the fix silently
  // degrades back to the fixed 384k reservation — guard against that here.
  it('deepseek-v4-pro card exposes the context window the fix depends on', () => {
    const card = deepseekChatModels.find((m) => m.id === 'deepseek-v4-pro');
    expect(card?.contextWindowTokens).toBe(1_048_576);
    expect(card?.maxOutput).toBe(393_216);
  });

  // Wiring proof: with the fixed 393_216 reservation this prompt (which alone
  // fits nowhere near the window) would be shipped and rejected upstream as an
  // opaque ExceededContextWindow. Routing max_tokens through resolveSafeMaxTokens
  // makes it fail fast, locally, with a structured pre-flight error.
  it('fails fast with a pre-flight error when the prompt overflows the window', async () => {
    // ~10M chars — unambiguously over the 1,048,576-token window regardless of
    // the exact tokenizer ratio.
    const huge = 'lorem ipsum dolor '.repeat(560_000);

    await expect(
      buildDeepSeekAnthropicPayload({
        messages: [{ content: huge, role: 'user' }],
        model: 'deepseek-v4-pro',
      } as any),
    ).rejects.toBeInstanceOf(ContextExceededPreFlightError);
  });

  // Anthropic moves `system` into its own top-level field, so a system-only
  // turn leaves `messages: []` and the upstream rejects it with `400 messages:
  // at least one message is required`. buildDefaultAnthropicPayload must fail
  // fast rather than dispatch it (a length check in call_llm can't catch this —
  // the array is non-empty until system extraction).
  it('throws when only a system message remains after anthropic system extraction', async () => {
    await expect(
      buildDeepSeekAnthropicPayload({
        messages: [{ content: 'You are a helpful assistant.', role: 'system' }],
        model: 'deepseek-v4-pro',
      } as any),
    ).rejects.toThrow(/empty messages array/);
  });

  // A normal small prompt must still produce a usable payload (no regression /
  // no spurious pre-flight throw for the common case).
  it('produces a payload with a positive max_tokens for a small prompt', async () => {
    const payload = await buildDeepSeekAnthropicPayload({
      messages: [{ content: 'hello', role: 'user' }],
      model: 'deepseek-v4-pro',
    } as any);

    expect(typeof payload.max_tokens).toBe('number');
    expect(payload.max_tokens).toBeGreaterThan(0);
    expect(payload.max_tokens).toBeLessThanOrEqual(393_216);
  });
});
