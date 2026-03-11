import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { identityPrompt } from '../prompts';
import type { IdentityExtractorTemplateProps } from './identity';
import { IdentityExtractor } from './identity';

const runtimeMock = { generateObject: vi.fn() } as unknown as ModelRuntime;
const extractorConfig = {
  agent: 'layer-identity' as const,
  model: 'gpt-mock',
  modelRuntime: runtimeMock,
};

const templateOptions: IdentityExtractorTemplateProps = {
  availableCategories: ['work', 'personal'],
  existingIdentitiesContext: 'existing identities',
  language: 'English',
  retrievedContexts: ['existing context'],
  sessionDate: '2024-06-01',
  topK: 3,
  username: 'User',
};

describe('IdentityExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a structured schema without registering tools', () => {
    const extractor = new IdentityExtractor(extractorConfig);

    const tools = (extractor as any).getTools(templateOptions);
    const schema = (extractor as any).getSchema(templateOptions);

    expect(tools).toBeUndefined();
    expect(schema).toBeDefined();
    expect(schema?.name).toContain('identity');
  });

  it('uses structuredCall to invoke the runtime and parse structured results', async () => {
    const extractor = new IdentityExtractor(extractorConfig);
    // Mock data matching IdentityActionsSchema structure
    const structuredResult = {
      add: [
        {
          details: null,
          memoryCategory: 'personal',
          memoryType: 'fact',
          summary: 'New identity summary',
          tags: ['tag'],
          title: 'New identity',
          withIdentity: {
            description: 'New identity description',
            episodicDate: null,
            extractedLabels: ['tag'],
            relationship: 'self',
            role: 'developer',
            scoreConfidence: 0.8,
            sourceEvidence: null,
            type: 'personal',
          },
        },
      ],
      remove: null,
      update: null,
    };
    (runtimeMock.generateObject as any) = vi.fn().mockResolvedValue(structuredResult);

    const result = await extractor.structuredCall(templateOptions);

    expect(runtimeMock.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-mock',
        schema: expect.objectContaining({ name: expect.stringContaining('identity') }),
        tools: undefined,
      }),
    );
    expect(result).toEqual(structuredResult);
  });

  it('returns full template props from options', () => {
    const extractor = new IdentityExtractor(extractorConfig);

    expect((extractor as any).getTemplateProps(templateOptions)).toEqual({
      availableCategories: templateOptions.availableCategories,
      existingIdentitiesContext: templateOptions.existingIdentitiesContext,
      language: templateOptions.language,
      retrievedContext:
        templateOptions.retrievedContexts?.join('\n\n') || 'No similar memories retrieved.',
      sessionDate: templateOptions.sessionDate,
      topK: templateOptions.topK,
      username: templateOptions.username,
    });
  });

  it('throws when building user prompt without template', () => {
    const extractor = new IdentityExtractor(extractorConfig);

    expect(() => (extractor as any).buildUserPrompt(templateOptions)).toThrowError(
      'Prompt template not loaded',
    );
  });

  it('renders user prompt with provided template props', async () => {
    const extractor = new IdentityExtractor(extractorConfig);

    await extractor.ensurePromptTemplate();
    const result = (extractor as any).buildUserPrompt(templateOptions);
    const expectedProps = (extractor as any).getTemplateProps(templateOptions);

    expect(result).not.toBe('');
    expect(result).toBe(renderPlaceholderTemplate(identityPrompt, expectedProps));
  });
});
