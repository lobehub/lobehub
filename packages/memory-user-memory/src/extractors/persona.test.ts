import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import type { ModelRuntime } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { userPersonaPrompt } from '../prompts';
import type { PersonaTemplateProps } from '../types';
import { UserPersonaExtractor } from './persona';

const runtimeMock = { generateObject: vi.fn() } as unknown as ModelRuntime;
const extractorConfig = {
  agent: 'user-persona' as const,
  model: 'gpt-mock',
  modelRuntime: runtimeMock,
};

const templateOptions: PersonaTemplateProps = {
  existingPersona: '# Existing',
  language: 'English',
  recentEvents: '- Event 1',
  retrievedMemories: '- mem',
  personaNotes: '- note',
  userProfile: '- profile',
  username: 'User',
};

describe('UserPersonaExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes function tool for committing personas', async () => {
    const extractor = new UserPersonaExtractor(extractorConfig);
    const tools = (extractor as any).getTools();

    expect(tools).toHaveLength(1);
    expect(tools?.[0].function?.name).toBe('commit_user_persona');
    expect((extractor as any).getSchema()).toBeUndefined();
  });

  it('renders user prompt with provided sections', async () => {
    const extractor = new UserPersonaExtractor(extractorConfig);
    await extractor.ensurePromptTemplate();

    const prompt = extractor.buildUserPrompt(templateOptions);
    expect(prompt).toContain('## Existing Persona');
    expect(prompt).toContain('# Existing');
    expect(prompt).toContain('Recent Events');
  });

  it('calls runtime with structured payload', async () => {
    const extractor = new UserPersonaExtractor(extractorConfig);
    await extractor.ensurePromptTemplate();

    runtimeMock.generateObject = vi.fn().mockResolvedValue([
      {
        arguments: JSON.stringify({
          diff: '- updated',
          memoryIds: ['mem-1'],
          reasoning: 'why',
          sourceIds: ['src-1'],
          persona: '# Persona',
          tagline: 'pithy',
        }),
        name: 'commit_user_persona',
      },
    ]);

    const result = await extractor.toolCall(templateOptions);

    expect(result.persona).toBe('# Persona');
    expect(runtimeMock.generateObject).toHaveBeenCalledTimes(1);

    const call = (runtimeMock.generateObject as any).mock.calls[0][0];
    expect(call.model).toBe('gpt-mock');
    expect(call.messages[0].content).toBe(
      renderPlaceholderTemplate(userPersonaPrompt, {
        language: 'English',
        topK: 10,
        username: 'User',
      }),
    );
  });
});
