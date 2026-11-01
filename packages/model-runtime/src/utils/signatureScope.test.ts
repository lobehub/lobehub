import { describe, expect, it } from 'vitest';

import {
  createSignatureChannelId,
  createSignatureScope,
  resolveScopedSignature,
  serializeScopedSignature,
} from './signatureScope';

const createScope = async (
  overrides: Partial<{
    apiType: string;
    channelId: string;
    kind: 'reasoning' | 'thought_signature';
    model: string;
    protocol: string;
    provider: string;
    routerId: string;
  }> = {},
) =>
  createSignatureScope({
    kind: overrides.kind ?? 'reasoning',
    model: overrides.model ?? 'gpt-5.6-sol',
    protocol: overrides.protocol ?? 'responses',
    source: {
      apiType: overrides.apiType ?? 'openai',
      channelId: overrides.channelId ?? 'channel-a',
      provider: overrides.provider ?? 'chatgpt',
      routerId: overrides.routerId ?? 'router-a',
    },
  });

describe('signatureScope', () => {
  it('round-trips opaque state only within the exact scope', async () => {
    const sourceScope = await createScope();
    const value = serializeScopedSignature('encrypted-state', sourceScope, 'reasoning');

    expect(resolveScopedSignature(value, await createScope(), 'reasoning')).toBe('encrypted-state');
    expect(
      resolveScopedSignature(value, await createScope({ model: 'gpt-5.6-terra' }), 'reasoning'),
    ).toBeUndefined();
    expect(
      resolveScopedSignature(value, await createScope({ apiType: 'vertexai' }), 'reasoning'),
    ).toBeUndefined();
    expect(
      resolveScopedSignature(
        value,
        await createScope({ protocol: 'chat_completions' }),
        'reasoning',
      ),
    ).toBeUndefined();
    expect(
      resolveScopedSignature(value, await createScope({ routerId: 'router-b' }), 'reasoning'),
    ).toBeUndefined();
    expect(
      resolveScopedSignature(value, await createScope({ channelId: 'channel-b' }), 'reasoning'),
    ).toBeUndefined();
  });

  it('separates reasoning state from thought signatures', async () => {
    const reasoningScope = await createScope();
    const value = serializeScopedSignature('encrypted-state', reasoningScope, 'reasoning');
    const thoughtScope = await createScope({ kind: 'thought_signature' });

    expect(resolveScopedSignature(value, thoughtScope, 'thought_signature')).toBeUndefined();
  });

  it('fails closed for missing channel identity and legacy values', async () => {
    const scopeWithoutChannel = await createSignatureScope({
      kind: 'reasoning',
      model: 'gpt-5.6-sol',
      protocol: 'responses',
      source: {
        apiType: 'openai',
        provider: 'chatgpt',
      },
    });

    expect(scopeWithoutChannel).toBeUndefined();
    expect(serializeScopedSignature('encrypted-state', scopeWithoutChannel, 'reasoning')).toBe(
      undefined,
    );
    expect(
      resolveScopedSignature('legacy-encrypted-state', await createScope(), 'reasoning'),
    ).toBeUndefined();
  });

  it('persists only irreversible fingerprints of endpoint and credentials', async () => {
    const endpoint = 'https://example.com/v1';
    const credential = 'secret-api-key';
    const channelId = await createSignatureChannelId(endpoint, credential);
    const scope = await createScope({ channelId });
    const value = serializeScopedSignature('opaque-state', scope, 'reasoning')!;

    expect(channelId).toMatch(/^[\da-f]{32}$/);
    expect(value).not.toContain(endpoint);
    expect(value).not.toContain(credential);
  });
});
