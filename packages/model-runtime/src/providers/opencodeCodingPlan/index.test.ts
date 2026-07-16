// @vitest-environment node
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenCodeCodingPlanAI, sanitizeJsonSchema } from './index';

// The router pulls the cloud model-bank config for deepseek route resolution,
// which transitively imports server-only modules (e.g. redis-client). Stub it
// so the OpenAI-compatible chat route can be exercised in the node test env.
const { loadModelsMock } = vi.hoisted(() => ({ loadModelsMock: vi.fn() }));
vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const provider = ModelProvider.OpenCodeCodingPlan;
const defaultBaseURL = 'https://opencode.ai/zen/go/v1';

// Avoid a real models.dev fetch during router resolution; the failure path falls
// back to the hardcoded interleaved snapshot, which is what these tests assert on.
global.fetch = vi.fn().mockRejectedValue(new Error('no network in test')) as any;

// Silence the router's console.error on the mocked (never-resolving) fetch path.
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('LobeOpenCodeCodingPlanAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeOpenCodeCodingPlanAI);
    });
  });
});

describe('sanitizeJsonSchema', () => {
  it('should return non-object values as-is', () => {
    expect(sanitizeJsonSchema(null)).toBeNull();
    expect(sanitizeJsonSchema(undefined)).toBeUndefined();
    expect(sanitizeJsonSchema('string')).toBe('string');
    expect(sanitizeJsonSchema(42)).toBe(42);
  });

  it('should remove null from enum arrays', () => {
    const schema = {
      type: 'string',
      enum: ['heartbeat', 'schedule', null],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.enum).toEqual(['heartbeat', 'schedule']);
  });

  it('should simplify type: ["string", "null"] to type: "string"', () => {
    const schema = {
      type: ['string', 'null'],
      enum: ['heartbeat', 'schedule', null],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.type).toBe('string');
    expect(result.enum).toEqual(['heartbeat', 'schedule']);
  });

  it('should keep type: ["string", "number"] as array (no null)', () => {
    const schema = { type: ['string', 'number'] };
    expect(sanitizeJsonSchema(schema).type).toEqual(['string', 'number']);
  });

  it('should drop enum key if all values are null', () => {
    const schema = { type: 'string', enum: [null, null] };
    const result = sanitizeJsonSchema(schema);
    expect(result.enum).toBeUndefined();
  });

  it('should recurse into properties', () => {
    const schema = {
      type: 'object',
      properties: {
        action: {
          type: ['string', 'null'],
          enum: ['create', 'refine', 'consolidate', null],
        },
        name: { type: 'string' },
      },
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.properties.action.enum).toEqual(['create', 'refine', 'consolidate']);
    expect(result.properties.action.type).toBe('string');
    expect(result.properties.name).toEqual({ type: 'string' });
  });

  it('should recurse into allOf/anyOf/oneOf', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { x: { enum: ['a', null] } } },
        { type: 'object', properties: { y: { enum: ['b', null] } } },
      ],
      anyOf: [{ enum: ['c', null] }, { type: ['string', 'null'] }],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.allOf[0].properties.x.enum).toEqual(['a']);
    expect(result.allOf[1].properties.y.enum).toEqual(['b']);
    expect(result.anyOf[0].enum).toEqual(['c']);
    expect(result.anyOf[1].type).toBe('string');
  });

  it('should recurse into items and prefixItems', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { tag: { enum: ['alpha', 'beta', null] } },
      },
      prefixItems: [{ enum: ['x', null] }, { enum: ['y', null] }],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.items.properties.tag.enum).toEqual(['alpha', 'beta']);
    expect(result.prefixItems[0].enum).toEqual(['x']);
    expect(result.prefixItems[1].enum).toEqual(['y']);
  });

  it('should handle deeply nested schemas with $defs and if/then/else', () => {
    const schema = {
      $defs: {
        Foo: {
          type: 'object',
          properties: { status: { enum: ['ok', 'error', null] } },
        },
      },
      if: { properties: { x: { enum: ['a', null] } } },
      // `then` here is the JSON Schema if/then/else keyword, not a thenable.
      // eslint-disable-next-line unicorn/no-thenable
      then: { properties: { y: { type: ['string', 'null'] } } },
      else: { properties: { z: { enum: ['b', null] } } },
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.$defs.Foo.properties.status.enum).toEqual(['ok', 'error']);
    expect(result.if.properties.x.enum).toEqual(['a']);
    expect(result.then.properties.y.type).toBe('string');
    expect(result.else.properties.z.enum).toEqual(['b']);
  });

  it('should handle schemas without nullable enums (no-op)', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    expect(sanitizeJsonSchema(schema)).toEqual(schema);
  });
});

describe('buildOpenAIPayload Kimi thinking semantics', () => {
  let instance: InstanceType<typeof LobeOpenCodeCodingPlanAI>;
  let createSpy: Mock;

  const getLastRequestPayload = () => createSpy.mock.calls.at(-1)?.[0];

  const findAssistantMessage = (payload: any) =>
    payload.messages.find((message: any) => message.role === 'assistant');

  beforeEach(() => {
    loadModelsMock.mockResolvedValue([]);
    instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });
    // Kimi models route to the OpenAI-compatible fallback runtime, whose client
    // is built lazily per request; spy on the shared SDK prototype to capture
    // the outgoing chat.completions.create params.
    createSpy = vi
      .spyOn(OpenAI.Chat.Completions.prototype, 'create')
      .mockResolvedValue(new ReadableStream() as any) as unknown as Mock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('native-thinking K3 models (kimi-k3)', () => {
    it('should drop a saved thinking:disabled and keep reasoning_effort + forced reasoning_content', async () => {
      await instance.chat({
        messages: [
          { content: 'Hello', role: 'user' },
          { content: 'Response', role: 'assistant' },
          { content: 'Follow-up', role: 'user' },
        ],
        model: 'kimi-k3',
        reasoning_effort: 'high',
        thinking: { type: 'disabled' },
      } as any);

      const payload = getLastRequestPayload();

      // K3 rejects the `thinking` param entirely: no key must be emitted.
      expect('thinking' in payload).toBe(false);
      // disabled is ignored for native-thinking models, so reasoning_effort passes through.
      expect(payload.reasoning_effort).toBe('high');
      // assistant messages still get reasoning_content forced (fallback ' ').
      expect(findAssistantMessage(payload)?.reasoning_content).toBe(' ');
    });

    it('should not emit thinking even when thinking:enabled is provided', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'kimi-k3',
        thinking: { type: 'enabled' },
      } as any);

      const payload = getLastRequestPayload();

      // K3 configures reasoning via top-level reasoning_effort only; the K2.x
      // `thinking` param is never emitted, enabled or disabled.
      expect('thinking' in payload).toBe(false);
    });
  });

  describe('native-thinking K2.7 code model (kimi-k2.7-code)', () => {
    it('should not re-emit thinking:disabled and still force reasoning_content', async () => {
      await instance.chat({
        messages: [
          { content: 'Hello', role: 'user' },
          { content: 'Response', role: 'assistant' },
          { content: 'Follow-up', role: 'user' },
        ],
        model: 'kimi-k2.7-code',
        thinking: { type: 'disabled' },
      } as any);

      const payload = getLastRequestPayload();

      // Native-thinking models cannot turn reasoning off; disabled must not be re-emitted.
      expect('thinking' in payload).toBe(false);
      expect(findAssistantMessage(payload)?.reasoning_content).toBe(' ');
    });
  });

  describe('toggleable K2.x model (kimi-k2.6)', () => {
    it('should re-emit thinking:disabled and not force reasoning_content', async () => {
      await instance.chat({
        messages: [
          { content: 'Hello', role: 'user' },
          { content: 'Response', role: 'assistant' },
          { content: 'Follow-up', role: 'user' },
        ],
        model: 'kimi-k2.6',
        thinking: { type: 'disabled' },
      } as any);

      const payload = getLastRequestPayload();

      // Toggleable K2.x models keep the old behavior: disabled is honored and re-emitted.
      expect(payload.thinking).toEqual({ type: 'disabled' });
      // With thinking explicitly disabled, assistant messages are not forced to carry reasoning_content.
      expect(findAssistantMessage(payload)?.reasoning_content).toBeUndefined();
    });
  });
});
