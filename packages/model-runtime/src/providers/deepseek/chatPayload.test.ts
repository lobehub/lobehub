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

describe('buildDeepSeekAnthropicPayload — thinking history normalization', () => {
  const getAssistantMessages = (payload: any) =>
    payload.messages.filter((m: any) => m.role === 'assistant');

  // Regression for the production 400 `missing field 'thinking'`: signature-only
  // reasoning (Claude 5 `thinking.display: 'omitted'`) reaches this builder as a
  // context-engine thinking part whose `thinking` key vanishes on JSON
  // serialization. DeepSeek's strict deserializer rejects it, so the part must
  // be dropped and replaced by the proven `' '` placeholder.
  /**
   * Official API 400s only when the thinking block is missing. Replay-off /
   * leftover preview `none` still go through this builder, which must keep a
   * whitespace thinking field rather than omit the part.
   */
  it('emits a whitespace thinking block for tool-call history when reasoning was stripped', async () => {
    const payload = await buildDeepSeekAnthropicPayload({
      messages: [
        { content: 'Search weather', role: 'user' },
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{"city":"Beijing"}', name: 'get_weather' },
              id: 'call_1',
              type: 'function',
            },
          ],
        },
        { content: '{"temp":20}', role: 'tool', tool_call_id: 'call_1' },
      ],
      model: 'deepseek-v4-flash',
      thinking: { type: 'enabled' },
    } as any);

    const [assistant] = getAssistantMessages(payload);
    const thinkingParts = assistant.content.filter((p: any) => p.type === 'thinking');
    expect(thinkingParts).toEqual([{ thinking: ' ', type: 'thinking' }]);
    expect(payload.thinking).toMatchObject({ type: 'enabled' });
  });

  it('drops signature-only thinking parts and falls back to the placeholder block', async () => {
    const payload = await buildDeepSeekAnthropicPayload({
      messages: [
        { content: 'hi', role: 'user' },
        {
          content: [
            { signature: 'claude-signature', type: 'thinking' },
            { text: 'previous answer', type: 'text' },
          ],
          reasoning: { signature: 'claude-signature' },
          role: 'assistant',
        },
        { content: 'continue', role: 'user' },
      ],
      model: 'deepseek-v4-pro',
    } as any);

    const [assistant] = getAssistantMessages(payload);
    const thinkingParts = assistant.content.filter((p: any) => p.type === 'thinking');
    expect(thinkingParts).toEqual([{ thinking: ' ', type: 'thinking' }]);
    // Foreign signatures are not verifiable by DeepSeek and must never be forwarded.
    expect(JSON.stringify(payload.messages)).not.toContain('claude-signature');
  });

  it('strips foreign signatures but keeps thinking text without duplicating blocks', async () => {
    const payload = await buildDeepSeekAnthropicPayload({
      messages: [
        { content: 'hi', role: 'user' },
        {
          content: [
            { signature: 'claude-signature', thinking: 'claude thoughts', type: 'thinking' },
            { text: 'previous answer', type: 'text' },
          ],
          reasoning: { content: 'claude thoughts', signature: 'claude-signature' },
          role: 'assistant',
        },
        { content: 'continue', role: 'user' },
      ],
      model: 'deepseek-v4-pro',
    } as any);

    const [assistant] = getAssistantMessages(payload);
    const thinkingParts = assistant.content.filter((p: any) => p.type === 'thinking');
    expect(thinkingParts).toEqual([{ thinking: 'claude thoughts', type: 'thinking' }]);
  });

  it('serializes every thinking part with a string thinking field', async () => {
    const payload = await buildDeepSeekAnthropicPayload({
      messages: [
        { content: 'hi', role: 'user' },
        {
          content: [
            { signature: 'sig-a', type: 'thinking' },
            { text: 'a', type: 'text' },
          ],
          role: 'assistant',
        },
        { content: 'and then', role: 'user' },
        {
          content: 'plain answer',
          reasoning: { content: '', signature: 'sig-b' },
          role: 'assistant',
        },
        { content: 'continue', role: 'user' },
      ],
      model: 'deepseek-v4-pro',
    } as any);

    // Intentional JSON round-trip (not a deep clone) like the HTTP client does —
    // this is where `thinking: undefined` used to disappear.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    const serialized = JSON.parse(JSON.stringify(payload.messages));
    for (const message of serialized) {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type !== 'thinking') continue;
        expect(typeof part.thinking).toBe('string');
        expect(part.thinking.length).toBeGreaterThan(0);
        expect(part.signature).toBeUndefined();
      }
    }
  });
});
