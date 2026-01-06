import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MEMORY_CATEGORIES, memoryTypeValues } from '../schemas';
import type { ExtractorTemplateProps } from '../types';
import { ExperienceExtractor } from './experience';

const runtimeMock = { generateObject: vi.fn() } as unknown as ModelRuntime;
const extractorConfig = {
  agent: 'layer-experience' as const,
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

describe('ExperienceExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds generate object schema with experience constraints', () => {
    const extractor = new ExperienceExtractor(extractorConfig);

    const schema = (extractor as any).getSchema();
    expect(schema?.name).toBe('experience_extraction');
    expect(schema?.strict).toBe(true);

    const memories = (schema?.schema as any).properties.memories;
    const memoryItem = memories.items;

    expect(memories.type).toBe('array');
    expect(memoryItem.properties.memoryLayer.const).toBe('experience');
    expect(memoryItem.properties.memoryCategory.enum).toEqual(MEMORY_CATEGORIES);
    expect(memoryItem.properties.memoryType.enum).toEqual(memoryTypeValues);
    expect((schema?.schema as any).additionalProperties).toBe(false);
  });

  it('returns full template props from options', () => {
    const extractor = new ExperienceExtractor(extractorConfig);

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

  it('throws when building user prompt without template', () => {
    const extractor = new ExperienceExtractor(extractorConfig);

    expect(() => (extractor as any).buildUserPrompt(templateOptions)).toThrowError(
      'Prompt template not loaded',
    );
  });

  it('renders user prompt with provided template props', async () => {
    const extractor = new ExperienceExtractor(extractorConfig);

    await extractor.ensurePromptTemplate();
    const result = (extractor as any).buildUserPrompt(templateOptions);
    const expectedProps = (extractor as any).getTemplateProps(templateOptions);

    expect(result).not.toBe('');
    expect(result).toBe(
      renderPlaceholderTemplate(
        await readFile(
          new URL('../prompts/layers/experience.md', import.meta.url).pathname,
          'utf8',
        ),
        expectedProps,
      ),
    );
  });
});
