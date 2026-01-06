import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryTypeValues } from '../schemas';
import type { ExtractorTemplateProps } from '../types';
import { ContextExtractor } from './context';

const runtimeMock = { generateObject: vi.fn() } as unknown as ModelRuntime;
const extractorConfig = {
  agent: 'layer-context' as const,
  model: 'gpt-mock',
  modelRuntime: runtimeMock,
};

const templateOptions: ExtractorTemplateProps = {
  availableCategories: ['work', 'personal'],
  language: 'English',
  retrievedContexts: ['existing context'],
  sessionDate: '2024-06-01',
  topK: 3,
  username: 'User',
};

describe('ContextExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds generate object schema with context constraints', () => {
    const extractor = new ContextExtractor(extractorConfig);

    const schema = extractor.getSchema();
    expect(schema?.name).toBe('context_extraction');
    expect(schema?.strict).toBe(true);

    const memories = (schema?.schema as any).properties.memories;
    const memoryItem = memories.items;

    expect(memories.type).toBe('array');
    expect(memoryItem.properties.memoryLayer.const).toBe('context');
    // memoryCategory is a plain string in schema, not an enum
    expect(memoryItem.properties.memoryCategory.type).toBe('string');
    expect(memoryItem.properties.memoryType.enum).toEqual(memoryTypeValues);
    expect((schema?.schema as any).additionalProperties).toBe(false);
  });

  it('returns full template props from options', () => {
    const extractor = new ContextExtractor(extractorConfig);

    expect(extractor.getTemplateProps(templateOptions)).toEqual({
      availableCategories: templateOptions.availableCategories,
      language: templateOptions.language,
      retrievedContext:
        templateOptions.retrievedContexts?.join('\n\n') || 'No similar memories retrieved.',
      sessionDate: templateOptions.sessionDate,
      topK: templateOptions.topK,
      username: templateOptions.username,
    });
  });

  it('throws when building user prompt without template', async () => {
    const extractor = new ContextExtractor(extractorConfig);

    expect(() => extractor.buildUserPrompt(templateOptions)).toThrowError(
      'Prompt template not loaded',
    );
  });

  it('renders user prompt with provided template props', async () => {
    const extractor = new ContextExtractor(extractorConfig);

    await extractor.ensurePromptTemplate();
    const result = extractor.buildUserPrompt(templateOptions);
    const expectedProps = extractor.getTemplateProps(templateOptions);

    expect(result).not.toBe('');
    expect(result).toBe(
      renderPlaceholderTemplate(
        await readFile(new URL('../prompts/layers/context.md', import.meta.url).pathname, 'utf8'),
        expectedProps,
      ),
    );
  });
});
