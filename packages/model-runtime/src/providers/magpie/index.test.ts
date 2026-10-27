// @vitest-environment node
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { magpieModelKey, params } from './index';

const model = (over: Record<string, any>) => ({ object: 'model', ...over });

const serveModels = (data: any[]) => vi.fn().mockResolvedValue({ data, object: 'list' });

describe('magpieModelKey', () => {
  it('drops the provider prefix magpie puts on every id', () => {
    expect(magpieModelKey('workbuddy/kimi-k3-1')).toBe('kimi-k3-1');
    expect(magpieModelKey('anthropic/claude-opus-5.5')).toBe('claude-opus-5-5');
  });

  it('reads a version dot as magpie spells it, a dash', () => {
    expect(magpieModelKey('kimi-k3.1')).toBe('kimi-k3-1');
    expect(magpieModelKey('kimi-k2.7-code')).toBe('kimi-k2-7-code');
  });

  it('spells Fireworks p for a dot as a dash too', () => {
    expect(magpieModelKey('deepseek-v4p1')).toBe('deepseek-v4-1');
  });

  it('keeps a letter after the digits, so gpt-4o keeps its name', () => {
    expect(magpieModelKey('gpt-4o')).toBe('gpt-4o');
    expect(magpieModelKey('openai/gpt-4o-mini')).toBe('gpt-4o-mini');
  });

  it('takes a vendor snapshot date off', () => {
    expect(magpieModelKey('claude-opus-4-5-20251101')).toBe('claude-opus-4-5');
    expect(magpieModelKey('glm-4.6@20250501')).toBe('glm-4-6');
  });

  it('reduces spaces and underscores to one dash', () => {
    expect(magpieModelKey('GPT-6 Sol')).toBe('gpt-6-sol');
    expect(magpieModelKey('some_model')).toBe('some-model');
  });

  it('reads the model of a routing group, by either id magpie gives one', () => {
    expect(magpieModelKey('auto/claude-opus-5.5')).toBe('claude-opus-5-5');
    expect(magpieModelKey('group/auto-claude-opus-5-5')).toBe('claude-opus-5-5');
  });

  it('drops every prefix, not just one', () => {
    expect(magpieModelKey('remote/magpieai/openai/gpt-5.6-sol')).toBe('gpt-5-6-sol');
  });
});

describe('params', () => {
  it('registers as its own provider', () => {
    expect(params.provider).toBe(ModelProvider.Magpie);
  });

  it('points at the gateway on the loopback port', () => {
    expect(params.baseURL).toBe('http://127.0.0.1:3425/v1');
  });

  it('names LobeHub in the User-Agent the gateway counts callers by', () => {
    const client = params.customClient!.createClient!({ apiKey: 'placeholder-to-avoid-error' });

    expect(client).toBeInstanceOf(OpenAI);
    // The SDK keeps its headers on the client it builds.
    expect(client['_options']?.defaultHeaders?.['User-Agent']).toMatch(/^lobehub\//);
  });

  it('keeps a header it was handed, rather than overwriting it', () => {
    const client = params.customClient!.createClient!({
      apiKey: 'placeholder-to-avoid-error',
      defaultHeaders: { 'X-Trace': 'kept' },
    });

    expect(client['_options']?.defaultHeaders?.['X-Trace']).toBe('kept');
  });

  it('turns debug output on only when asked', () => {
    delete process.env.DEBUG_MAGPIE_CHAT_COMPLETION;
    delete process.env.DEBUG_MAGPIE_RESPONSES;
    expect(params.debug!.chatCompletion!()).toBe(false);
    expect(params.debug!.responses!()).toBe(false);

    process.env.DEBUG_MAGPIE_CHAT_COMPLETION = '1';
    process.env.DEBUG_MAGPIE_RESPONSES = '1';
    expect(params.debug!.chatCompletion!()).toBe(true);
    expect(params.debug!.responses!()).toBe(true);

    delete process.env.DEBUG_MAGPIE_CHAT_COMPLETION;
    delete process.env.DEBUG_MAGPIE_RESPONSES;
  });
});

describe('the model list magpie serves', () => {
  let listModels: ReturnType<typeof serveModels>;

  const load = async (data: any[]) => {
    listModels = serveModels(data);
    const client = { models: { list: listModels } } as any;

    return params.models!({ client } as any);
  };

  beforeEach(() => {
    listModels = serveModels([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the id magpie serves, so a request goes to the model it listed', async () => {
    const cards = await load([
      model({ id: 'workbuddy/kimi-k3-1', display_name: 'Kimi K3.1' }),
      model({ id: 'openai/gpt-5.6-sol', display_name: 'GPT-5.6 Sol' }),
    ]);

    expect(cards.map((c) => c.id)).toEqual(['workbuddy/kimi-k3-1', 'openai/gpt-5.6-sol']);
  });

  it('takes magpie’s window over model-bank’s, the user being able to set it', async () => {
    const cards = await load([model({ context_length: 400_000, id: 'anthropic/claude-opus-5.5' })]);

    expect(cards[0].contextWindowTokens).toBe(400_000);
  });

  it('takes magpie’s reply limit as it is, having kept it within the window already', async () => {
    const cards = await load([
      model({ context_length: 200_000, id: 'openai/gpt-5.6-sol', max_output_tokens: 128_000 }),
    ]);

    expect(cards[0].maxOutput).toBe(128_000);
  });

  it('takes whether the model sees images from magpie, which the user can switch either way', async () => {
    const sees = await load([
      model({ id: 'openai/gpt-5.6-sol', modalities: { input: ['text', 'image'] } }),
    ]);
    expect(sees[0].vision).toBe(true);

    const blind = await load([
      model({ id: 'openai/gpt-5.6-sol', modalities: { input: ['text'] } }),
    ]);
    expect(blind[0].vision).toBe(false);
  });

  it('leaves vision unsaid for a model magpie says nothing about', async () => {
    const cards = await load([model({ id: 'someone/unknown-model-x' })]);

    expect(cards[0]).not.toHaveProperty('vision', true);
  });

  it('takes the reasoning levels magpie kept', async () => {
    const cards = await load([
      model({ id: 'openai/gpt-5.6-sol', reasoning_levels: ['low', 'high'] }),
    ]);

    expect(cards[0].reasoning).toBe(true);
  });

  it('keeps the user switching reasoning off, rather than model-bank’s answer', async () => {
    const cards = await load([
      // model-bank says kimi-k3 thinks; the user turned it off in magpie.
      model({ id: 'moonshot/kimi-k3', reasoning: false }),
    ]);

    expect(cards[0].reasoning).toBe(false);
  });

  it('leaves reasoning to model-bank and the id when magpie says nothing', async () => {
    const cards = await load([model({ id: 'somelab/experimental-llm-v0' })]);

    expect(cards[0].reasoning).toBe(false);
  });

  it('reads tool calls from model-bank, which is the only one that says', async () => {
    const cards = await load([model({ context_length: 1_000_000, id: 'moonshot/kimi-k3' })]);

    expect(cards[0].functionCall).toBe(true);
  });

  it('takes the reasoning parameter from model-bank, which is what makes a level selectable', async () => {
    const cards = await load([
      model({ id: 'moonshot/kimi-k3', reasoning_levels: ['low', 'medium', 'high'] }),
    ]);

    // magpie's levels say the model thinks; the parameter that turns the
    // strength differs by model family, and only model-bank names it.
    expect(cards[0].reasoning).toBe(true);
    expect(cards[0].settings?.extendParams).toEqual(['kimiK3ReasoningEffort']);
  });

  it('leaves the settings empty for a model model-bank does not know', async () => {
    const cards = await load([model({ id: 'somelab/experimental-llm-v0' })]);

    expect(cards[0].settings).toBeUndefined();
  });

  it('offers no thinking strength once the user turned thinking off in magpie', async () => {
    const cards = await load([
      model({ id: 'moonshot/kimi-k3', reasoning: false, reasoning_levels: ['low', 'high'] }),
    ]);

    // A level beside `reasoning: false` would let a choice be made that the
    // gateway pushes back up to its lowest thinking level.
    expect(cards[0].reasoning).toBe(false);
    expect(cards[0].settings?.extendParams).toBeUndefined();
  });

  it('carries the params the vendor refuses, so the settings page hides them', async () => {
    const cards = await load([model({ id: 'moonshot/kimi-k3' })]);

    expect(cards[0].settings?.disabledParams).toEqual([
      'frequency_penalty',
      'presence_penalty',
      'temperature',
      'top_p',
    ]);
  });

  it('reaches a model-bank entry through the dot magpie spells as a dash', async () => {
    // `kimi-k3.1` is moonshot's; magpie serves it as `kimi-k3-1`.
    const cards = await load([model({ id: 'workbuddy/kimi-k3-1' })]);

    expect(cards[0].functionCall).toBeDefined();
  });

  it('reaches model-bank for a routing group too, the group serving that one model', async () => {
    // A group magpie found for kimi-k3, under the id it hands out. Asserting the
    // reasoning param rather than tool calls keeps this about the lookup: tool
    // calls also come out true from the vendor keyword alone, so they pass
    // whether or not model-bank was reached.
    const cards = await load([model({ id: 'auto/kimi-k3' })]);

    expect(cards[0].settings?.extendParams).toContain('kimiK3ReasoningEffort');
  });

  it('finds no model-bank entry for a group of the user’s own, leaving the settings empty', async () => {
    const cards = await load([model({ id: 'group/my-fastest' })]);

    expect(cards[0].settings).toBeUndefined();
  });

  it('takes the name alone, the tag saying what a group is', async () => {
    const cards = await load([
      model({
        display_name: 'Claude Opus 5.5',
        id: 'group/auto-claude-opus-5-5',
        magpie_label: 'Claude Opus 5.5 · routing group',
      }),
    ]);

    expect(cards[0].displayName).toBe('Claude Opus 5.5');
  });

  it('keeps a label that says nothing extra, having no ` · ` to cut', async () => {
    const cards = await load([
      model({ id: 'somelab/experimental-llm-v0', magpie_label: 'experimental-llm-v0' }),
    ]);

    expect(cards[0].displayName).toBe('experimental-llm-v0');
  });

  it('keeps the provider magpie puts after the name, two vendors serving one model', async () => {
    const cards = await load([
      model({
        display_name: 'GPT-5.6 Sol',
        id: 'openai/gpt-5.6-sol',
        magpie_label: 'GPT-5.6 Sol · OpenAI',
      }),
      model({
        display_name: 'GPT-5.6 Sol',
        id: 'workbuddy/gpt-5.6-sol',
        magpie_label: 'GPT-5.6 Sol · WorkBuddy',
      }),
    ]);

    // Both rows sit under magpie, so the provider is the only thing telling the
    // two apart in the picker.
    expect(cards.map((c) => c.displayName)).toEqual([
      'GPT-5.6 Sol · OpenAI',
      'GPT-5.6 Sol · WorkBuddy',
    ]);
  });

  it('lists a model once though magpie repeats its row', async () => {
    const cards = await load([
      model({ display_name: 'GPT-5.6 Sol', id: 'openai/gpt-5.6-sol' }),
      model({ display_name: 'GPT-5.6 Sol', id: 'openai/gpt-5.6-sol' }),
    ]);

    expect(cards).toHaveLength(1);
  });

  it('drops the bare id magpie lists beside the model it names', async () => {
    const cards = await load([
      model({ display_name: 'GPT-5.6 Sol', id: 'openai/gpt-5.6-sol' }),
      model({ display_name: 'GPT-5.6 Sol', id: 'gpt-5.6-sol' }),
    ]);

    expect(cards.map((c) => c.id)).toEqual(['openai/gpt-5.6-sol']);
  });

  it('keeps two providers serving one model apart, both ids carrying a prefix', async () => {
    const cards = await load([
      model({ display_name: 'GPT-5.6 Sol', id: 'openai/gpt-5.6-sol' }),
      model({ display_name: 'GPT-5.6 Sol', id: 'cpa/gpt-5.6-sol' }),
    ]);

    expect(cards.map((c) => c.id)).toEqual(['openai/gpt-5.6-sol', 'cpa/gpt-5.6-sol']);
  });

  it('asks the gateway for its list once', async () => {
    await load([model({ id: 'openai/gpt-5.6-sol' })]);

    expect(listModels).toHaveBeenCalledTimes(1);
  });
});
