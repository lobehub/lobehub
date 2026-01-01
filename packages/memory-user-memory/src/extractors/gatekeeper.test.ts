import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GatekeeperOptions } from '../types';
import { UserMemoryGateKeeper } from './gatekeeper';

const runtimeMock = { generateObject: vi.fn() } as unknown as ModelRuntime;
const extractorConfig = {
  agent: 'gatekeeper' as const,
  model: 'gpt-mock',
  modelRuntime: runtimeMock,
};

const templateOptions: GatekeeperOptions = {
  retrievedContexts: ['existing context'],
  topK: 2,
};

describe('UserMemoryGateKeeper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds generate object schema with layer decisions', () => {
    const extractor = new UserMemoryGateKeeper(extractorConfig);

    const schema = extractor.getSchema();
    expect(schema?.name).toBe('gatekeeper_decision');
    expect(schema?.strict).toBe(true);

    const properties = (schema?.schema as any).properties;
    const requiredLayers = ['context', 'experience', 'identity', 'preference'];

    requiredLayers.forEach((layer) => {
      const layerSchema = properties[layer];
      expect(layerSchema.type).toBe('object');
      expect(layerSchema.required).toEqual(['reasoning', 'shouldExtract']);
      expect(layerSchema.properties.reasoning.type).toBe('string');
      expect(layerSchema.properties.shouldExtract.type).toBe('boolean');
      expect(layerSchema.additionalProperties).toBe(false);
    });

    expect((schema?.schema as any).required).toEqual(requiredLayers);
    expect((schema?.schema as any).additionalProperties).toBe(false);
  });

  it('returns template props with defaults applied', () => {
    const extractor = new UserMemoryGateKeeper(extractorConfig);

    expect(extractor.getTemplateProps({} as GatekeeperOptions)).toEqual({
      retrievedContext: 'No similar memories retrieved.',
      topK: 10,
    });
  });

  it('throws when building user prompt without template', () => {
    const extractor = new UserMemoryGateKeeper(extractorConfig);

    expect(() => extractor.buildUserPrompt(templateOptions)).toThrowError(
      'Prompt template not loaded',
    );
  });

  it('renders user prompt with provided template props', async () => {
    const extractor = new UserMemoryGateKeeper(extractorConfig);

    await extractor.ensurePromptTemplate();
    const result = extractor.buildUserPrompt(templateOptions);
    const expectedProps = extractor.getTemplateProps(templateOptions);

    expect(result).not.toBe('');
    expect(result).toBe(
      renderPlaceholderTemplate(
        await readFile(new URL('../prompts/gatekeeper.md', import.meta.url).pathname, 'utf8'),
        expectedProps,
      ),
    );
  });

  it('parses gatekeeper decisions from structured call', async () => {
    const extractor = new UserMemoryGateKeeper(extractorConfig);

    const llmResult = {
      context: { reasoning: 'reasoning', shouldExtract: true },
      experience: { reasoning: 'reasoning', shouldExtract: false },
      identity: { reasoning: 'reasoning', shouldExtract: true },
      preference: { reasoning: 'reasoning', shouldExtract: true },
    };

    runtimeMock.generateObject = vi.fn().mockResolvedValue(llmResult) as any;

    const result = await extractor.check(templateOptions);

    expect(result).toEqual(llmResult);
    expect(runtimeMock.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-mock',
        schema: expect.any(Object),
      }),
    );
  });
});
